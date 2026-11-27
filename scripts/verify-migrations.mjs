import assert from "node:assert/strict";
import { migrate, openLocalDatabase, readMigrations } from "./migrate-local.mjs";

const migrations = await readMigrations();
async function scenario(run) {
  const proxy = await openLocalDatabase(false);
  try { await run(proxy.env.DB); }
  finally { await proxy.dispose(); }
}

await scenario(async (db) => {
  assert.equal((await migrate(db)).length, migrations.length);
  assert.deepEqual(await migrate(db), []);
  await assert.rejects(migrate(db, [{ ...migrations[0], hash: "changed" }]), /迁移历史不匹配/);
  console.log("✓ 新库初始化、重复运行和迁移内容校验");
});
await scenario(async (db) => {
  await db.batch(migrations[0].statements.map((sql) => db.prepare(sql)));
  await db.prepare("INSERT INTO life_draw_spaces (id, name, state) VALUES ('fixture', '合成空间', '{}')").run();
  assert.match((await migrate(db))[0], /接管已有结构/);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM life_draw_spaces").first()).n, 1);
  assert.deepEqual(await migrate(db), []);
  console.log("✓ 已有未记账初始结构安全接管，保留数据");
});
await scenario(async (db) => {
  await db.prepare("CREATE TABLE life_draw_spaces (id TEXT PRIMARY KEY)").run();
  await assert.rejects(migrate(db), /结构与初始迁移不一致/);
  assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'life_draw_migrations'").first(), null);
  console.log("✓ 结构不匹配时停止，未创建迁移记录");
});
await scenario(async (db) => {
  await migrate(db);
  await assert.rejects(migrate(db, [...migrations, {
    tag: "fixture-failure", hash: "fixture",
    statements: ["CREATE TABLE fixture_partial (id TEXT)", "INVALID SQL"],
  }]));
  assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'fixture_partial'").first(), null);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM life_draw_migrations").first()).n, migrations.length);
  console.log("✓ 后续迁移失败时整批回滚");
});
