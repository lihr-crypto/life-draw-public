import "./sites-env.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const journalPath = new URL("../drizzle/meta/_journal.json", import.meta.url);
const normaliseSql = (sql) => sql.replace(/[`";]/g, "").replace(/\s+/g, "").toLowerCase();

export async function readMigrations() {
  const { entries } = JSON.parse(await readFile(journalPath, "utf8"));
  return Promise.all(entries.map(async ({ tag }) => {
    const sql = await readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8");
    return {
      tag,
      hash: createHash("sha256").update(sql).digest("hex"),
      statements: sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean),
    };
  }));
}

export async function migrate(db, migrations) {
  migrations ??= await readMigrations();
  const schema = (await db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL").all()).results;
  const hasJournal = schema.some(({ name }) => name === "life_draw_migrations");
  const applied = hasJournal
    ? (await db.prepare("SELECT tag, hash FROM life_draw_migrations ORDER BY id").all()).results
    : [];
  for (const [index, entry] of applied.entries()) {
    if (migrations[index]?.tag !== entry.tag || migrations[index]?.hash !== entry.hash) {
      throw new Error(`迁移历史不匹配：${entry.tag}。请恢复原迁移文件，不要重放或修改已应用迁移。`);
    }
  }

  // The first QA database was initialized directly from the initial SQL.
  // Adopt it only when every table/index matches; never replay CREATE TABLE.
  let adoptInitial = false;
  if (!applied.length && schema.some(({ name }) => name.startsWith("life_draw_") && name !== "life_draw_migrations")) {
    const initial = migrations[0];
    if (initial?.tag !== "0000_blushing_emma_frost" || !initial.statements.every((statement) =>
      schema.some(({ sql }) => normaliseSql(sql) === normaliseSql(statement)))) {
      throw new Error("已有本地结构与初始迁移不一致。未修改数据；请先备份并检查结构，禁止盲目重放建表。 ");
    }
    adoptInitial = true;
  }

  const pending = migrations.slice(applied.length);
  if (!pending.length) return [];
  const statements = [db.prepare(`CREATE TABLE IF NOT EXISTS life_draw_migrations (
    id INTEGER PRIMARY KEY, tag TEXT NOT NULL UNIQUE, hash TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)];
  for (const [offset, migration] of pending.entries()) {
    if (!(adoptInitial && offset === 0)) statements.push(...migration.statements.map((sql) => db.prepare(sql)));
    statements.push(db.prepare("INSERT INTO life_draw_migrations (id, tag, hash) VALUES (?, ?, ?)")
      .bind(applied.length + offset, migration.tag, migration.hash));
  }
  // D1 batch is atomic: failed migrations do not leave a partial schema/journal.
  await db.batch(statements);
  return pending.map(({ tag }, index) => `${adoptInitial && index === 0 ? "接管已有结构" : "应用"} ${tag}`);
}

export async function openLocalDatabase(persist = true) {
  const { getPlatformProxy } = await import("wrangler");
  return getPlatformProxy({
    configPath: fileURLToPath(new URL("../wrangler.local.json", import.meta.url)),
    persist,
    remoteBindings: false,
    envFiles: [],
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error("此命令只操作 .wrangler/state/v3 本地 D1，不接受远端参数。 ");
  const proxy = await openLocalDatabase();
  try {
    const changes = await migrate(proxy.env.DB);
    console.log(changes.length ? changes.join("\n") : "本地 D1 已是最新，无需修改。");
  } finally {
    await proxy.dispose();
  }
}
