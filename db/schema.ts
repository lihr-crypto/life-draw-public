import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * The application state is kept in one JSON document per space.  Mutations
 * update the document with a version predicate, which gives the request
 * handlers a small compare-and-swap primitive on D1.  Members and invites
 * remain relational so that D1 can enforce their uniqueness independently of
 * the JSON document.
 */
export const spaces = sqliteTable("life_draw_spaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  state: text("state").notNull(),
  version: integer("version").notNull().default(0),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

export const members = sqliteTable(
  "life_draw_members",
  {
    userId: text("user_id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    spaceIndex: index("life_draw_members_space_idx").on(table.spaceId),
  }),
);

export const invites = sqliteTable(
  "life_draw_invites",
  {
    spaceId: text("space_id")
      .primaryKey()
      .references(() => spaces.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    tokenHashIndex: uniqueIndex("life_draw_invites_token_hash_idx").on(
      table.tokenHash,
    ),
  }),
);
