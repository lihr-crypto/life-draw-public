import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../db";
import { invites, members, spaces } from "../../db/schema";
import { sha256Hex, randomToken } from "./auth";
import {
  addMember,
  applyCancel,
  applyComplete,
  applyDraw,
  applyLibraryMutation,
  applyRedraw,
  applyReveal,
  applyRespond,
  applySelect,
  createInitialState,
  parseState,
  serializeState,
  toAppState,
  toLibraryResponse,
  exportItems,
  type SpaceRecord,
  type StoredState,
} from "./core";
import { requireMemberError, ServiceError } from "./errors";
import type { ImportItem, LibraryMutation, ProposalAction } from "../contracts";

type MembershipRow = typeof members.$inferSelect;
type SpaceRow = typeof spaces.$inferSelect;

export type UserSpace = {
  member: MembershipRow;
  row: SpaceRow;
  state: StoredState;
};

function toSpaceRecord(row: SpaceRow): SpaceRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    state: row.state,
  };
}

function changedRows(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const value = result as {
    rowsAffected?: number;
    meta?: { changes?: number };
    changes?: number;
  };
  return Number(value.rowsAffected ?? value.meta?.changes ?? value.changes ?? 0);
}

async function membershipForUser(userId: string): Promise<MembershipRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(members)
    .where(eq(members.userId, userId))
    .limit(1);
  return row ?? null;
}

async function spaceById(spaceId: string): Promise<SpaceRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  return row ?? null;
}

export async function userSpace(userId: string): Promise<UserSpace | null> {
  const member = await membershipForUser(userId);
  if (!member) return null;
  const row = await spaceById(member.spaceId);
  if (!row) {
    throw new ServiceError(500, "membership_orphaned", "成员空间数据缺失。");
  }
  return { member, row, state: parseState(row.state) };
}

export async function appStateForUser(
  userId: string,
  viewerName: string,
): Promise<ReturnType<typeof toAppState>> {
  const current = await userSpace(userId);
  if (!current) return toAppState(null, null, userId, viewerName);
  return toAppState(toSpaceRecord(current.row), current.state, userId, viewerName);
}

export async function createSpace(
  userId: string,
  memberName: string,
  requestedName?: string,
): Promise<UserSpace> {
  const existing = await userSpace(userId);
  if (existing) return existing;

  const db = getDb();
  const id = `space_${globalThis.crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const name = requestedName?.trim() || "我们的生活抽签";
  const state = createInitialState(userId, memberName.slice(0, 80), Date.now());
  try {
    await db.batch([
      db.insert(spaces).values({
        id,
        name,
        state: serializeState(state),
        version: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(members).values({
        userId,
        spaceId: id,
        name: memberName.slice(0, 80),
        createdAt: now,
      }),
    ]);
  } catch (error) {
    const concurrent = await userSpace(userId);
    if (concurrent) return concurrent;
    throw error;
  }
  const row = await spaceById(id);
  const member = await membershipForUser(userId);
  if (!row || !member) {
    throw new ServiceError(500, "space_create_failed", "空间创建失败。");
  }
  return { row, member, state: parseState(row.state) };
}

export async function createInvite(userId: string): Promise<{
  token: string;
  expiresAt: number;
}> {
  const current = await userSpace(userId);
  if (!current) throw requireMemberError();
  if (current.state.members.length >= 2) {
    throw new ServiceError(409, "space_full", "两位成员已经配对，不能再生成邀请。");
  }
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 24 * 60 * 60;
  const db = getDb();
  await db
    .insert(invites)
    .values({
      spaceId: current.row.id,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: invites.spaceId,
      set: { tokenHash, expiresAt, usedAt: null, createdAt: now },
    })
    .run();
  return { token, expiresAt };
}

export async function joinSpace(
  userId: string,
  memberName: string,
  token: string,
): Promise<UserSpace> {
  const tokenHash = await sha256Hex(token);
  const db = getDb();
  const d1 = getD1();
  const safeMemberName = memberName.slice(0, 80);
  // Five attempts cover a short burst of unrelated CAS updates while keeping
  // a permanently contended or malformed request bounded.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await membershipForUser(userId);
    const [invite] = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, tokenHash))
      .limit(1);
    if (!invite) {
      if (existing) {
        throw new ServiceError(409, "already_joined", "你已经加入一个空间。");
      }
      throw new ServiceError(400, "invalid_invite", "邀请链接无效或已失效。");
    }
    const target = await spaceById(invite.spaceId);
    if (!target) {
      throw new ServiceError(400, "invalid_invite", "邀请链接无效或已失效。");
    }
    const targetState = parseState(target.state);
    if (existing) {
      if (existing.spaceId === target.id) {
        return { member: existing, row: target, state: targetState };
      }
      throw new ServiceError(409, "already_joined", "你已经加入另一个空间。");
    }

    const now = Math.floor(Date.now() / 1000);
    if (invite.usedAt || invite.expiresAt <= now) {
      throw new ServiceError(400, "invalid_invite", "邀请链接无效或已失效。");
    }
    if (targetState.members.length >= 2) {
      throw new ServiceError(409, "space_full", "这个空间已经有两位成员。");
    }

    addMember(targetState, userId, safeMemberName);
    const nextVersion = target.version + 1;
    // JSON.stringify produces the exact property/value fragment used by
    // serializeState, including escaping for unusual trusted user IDs.  The
    // marker lets later batch statements prove that this CAS wrote the state.
    const userMarker = `\"userId\":${JSON.stringify(userId)}`;
    try {
      // Drizzle's SQLiteRaw (returned by db.run(sql)) cannot be passed to
      // SQLiteD1Session.batch when it has bound parameters: the D1 adapter
      // expects a query builder with a prepared statement. Use the native D1
      // prepared-statement batch here so all three writes remain one atomic
      // D1 batch while retaining the CAS/marker predicates.
      const results = await d1.batch([
        d1
          .prepare(
            `UPDATE life_draw_spaces
             SET state = ?, version = ?, updated_at = ?
             WHERE id = ?
               AND version = ?
               AND instr(life_draw_spaces.state, ?) = 0
               AND EXISTS (
                 SELECT 1 FROM life_draw_invites
                 WHERE space_id = ?
                   AND token_hash = ?
                   AND used_at IS NULL
                   AND expires_at > ?
               )`,
          )
          .bind(
            serializeState(targetState),
            nextVersion,
            now,
            target.id,
            target.version,
            userMarker,
            target.id,
            tokenHash,
            now,
          ),
        d1
          .prepare(
            `INSERT INTO life_draw_members (user_id, space_id, name, created_at)
             SELECT ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM life_draw_spaces
               WHERE id = ?
                 AND version = ?
                 AND instr(state, ?) > 0
             )
               AND EXISTS (
                 SELECT 1 FROM life_draw_invites
                 WHERE space_id = ?
                   AND token_hash = ?
                   AND used_at IS NULL
                   AND expires_at > ?
               )`,
          )
          .bind(
            userId,
            target.id,
            safeMemberName,
            now,
            target.id,
            nextVersion,
            userMarker,
            target.id,
            tokenHash,
            now,
          ),
        d1
          .prepare(
            `UPDATE life_draw_invites
             SET used_at = ?
             WHERE space_id = ?
               AND token_hash = ?
               AND used_at IS NULL
               AND expires_at > ?
               AND EXISTS (
                 SELECT 1 FROM life_draw_spaces
                 WHERE id = ?
                   AND version = ?
                   AND instr(state, ?) > 0
               )`,
          )
          .bind(now, target.id, tokenHash, now, target.id, nextVersion, userMarker),
      ]);
      // These predicates make a partial result a no-op for the member and
      // invite rows.  Do not treat this check as a rollback mechanism.
      if (
        changedRows(results[0]) === 1 &&
        changedRows(results[1]) === 1 &&
        changedRows(results[2]) === 1
      ) {
        const row = await spaceById(target.id);
        const member = await membershipForUser(userId);
        if (!row || !member) throw new ServiceError(500, "join_failed", "加入空间失败。");
        return { row, member, state: parseState(row.state) };
      }
    } catch (error) {
      const nowMember = await membershipForUser(userId);
      if (nowMember?.spaceId === target.id) {
        const nowRow = await spaceById(target.id);
        if (nowRow) return { member: nowMember, row: nowRow, state: parseState(nowRow.state) };
      }
      if (attempt === 4 && !(error instanceof ServiceError)) throw error;
    }
  }
  throw new ServiceError(409, "invite_race", "邀请链接已被使用，请刷新后重试。");
}

export type SpaceMutationResult<T = void> = {
  current: UserSpace;
  value: T;
};

async function mutateSpace<T>(
  userId: string,
  mutation: (state: StoredState, row: SpaceRow) => { value: T; changed: boolean } | Promise<{ value: T; changed: boolean }>,
): Promise<SpaceMutationResult<T>> {
  const db = getDb();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const member = await membershipForUser(userId);
    if (!member) throw requireMemberError();
    const row = await spaceById(member.spaceId);
    if (!row) throw new ServiceError(500, "membership_orphaned", "成员空间数据缺失。");
    const state = parseState(row.state);
    const result = await mutation(state, row);
    if (!result.changed) return { current: { member, row, state }, value: result.value };
    const update = await db
      .update(spaces)
      .set({
        state: serializeState(state),
        version: row.version + 1,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(and(eq(spaces.id, row.id), eq(spaces.version, row.version)))
      .run();
    if (changedRows(update) === 1) {
      const updatedRow = { ...row, state: serializeState(state), version: row.version + 1 };
      return { current: { member, row: updatedRow, state }, value: result.value };
    }
  }
  throw new ServiceError(503, "concurrent_update", "空间正在更新，请重试。");
}

export async function mutateLibrary(
  userId: string,
  mutation: LibraryMutation,
): Promise<UserSpace> {
  const result = await mutateSpace(userId, (state) => {
    const before = serializeState(state);
    applyLibraryMutation(state, userId, mutation);
    return { value: undefined, changed: before !== serializeState(state) };
  });
  return result.current;
}

export async function mutateDraw(userId: string): Promise<UserSpace> {
  const result = await mutateSpace(userId, (state) => {
    const before = serializeState(state);
    applyDraw(state, userId);
    return { value: undefined, changed: before !== serializeState(state) };
  });
  return result.current;
}

export async function mutateReveal(userId: string, roundId: string): Promise<UserSpace> {
  const result = await mutateSpace(userId, (state) => {
    const before = serializeState(state);
    applyReveal(state, userId, roundId);
    return { value: undefined, changed: before !== serializeState(state) };
  });
  return result.current;
}

export async function mutateSelect(
  userId: string,
  roundId: string,
  cardId: string,
  proposalId: string,
): Promise<UserSpace> {
  const result = await mutateSpace(userId, (state) => {
    const before = serializeState(state);
    applySelect(state, userId, roundId, cardId, proposalId);
    return { value: undefined, changed: before !== serializeState(state) };
  });
  return result.current;
}

export async function mutateRedraw(
  userId: string,
  roundId: string,
  proposalId: string,
): Promise<UserSpace> {
  const result = await mutateSpace(userId, (state) => {
    const before = serializeState(state);
    applyRedraw(state, userId, roundId, proposalId);
    return { value: undefined, changed: before !== serializeState(state) };
  });
  return result.current;
}

export async function mutateRespond(
  userId: string,
  roundId: string,
  proposalId: string,
  action: ProposalAction,
): Promise<UserSpace> {
  const result = await mutateSpace(userId, (state) => {
    const before = serializeState(state);
    applyRespond(state, userId, roundId, proposalId, action);
    return { value: undefined, changed: before !== serializeState(state) };
  });
  return result.current;
}

export async function mutateComplete(userId: string, roundId: string): Promise<UserSpace> {
  const result = await mutateSpace(userId, (state) => {
    const before = serializeState(state);
    applyComplete(state, userId, roundId);
    return { value: undefined, changed: before !== serializeState(state) };
  });
  return result.current;
}

export async function mutateCancel(userId: string, roundId: string): Promise<UserSpace> {
  const result = await mutateSpace(userId, (state) => {
    const before = serializeState(state);
    applyCancel(state, userId, roundId);
    return { value: undefined, changed: before !== serializeState(state) };
  });
  return result.current;
}

export function stateResponse(
  current: UserSpace,
  userId: string,
  viewerName: string,
) {
  return toAppState(toSpaceRecord(current.row), current.state, userId, viewerName);
}

export function libraryResponse(current: UserSpace) {
  return toLibraryResponse(current.state);
}

export function exportResponse(current: UserSpace): { items: ImportItem[] } {
  return exportItems(current.state);
}
