import assert from "node:assert/strict";
import test from "node:test";
// Node's strip-types runner requires the explicit extension; the project
// compiler resolves the same module through its bundler settings.
// @ts-expect-error TS5097: Node's strip-types runner needs the extension.
import * as core from "../app/server/core.ts";
import type { StoredState } from "../app/server/core";

const {
  addMember,
  applyComplete,
  applyCancel,
  applyDraw,
  applyLibraryMutation,
  applyRedraw,
  applyReveal,
  applyRespond,
  applySelect,
  createInitialState,
  exportItems,
  parseState,
  serializeState,
  toAppState,
} = core;

function pairedState(): StoredState {
  const state = createInitialState("user-a", "甲", 1);
  addMember(state, "user-b", "乙");
  applyLibraryMutation(state, "user-a", {
    action: "bulkAdd",
    texts: ["第一条测试灵感", "第二条测试灵感", "第三条测试灵感"],
    activate: true,
  }, 2);
  return state;
}

function roundId(state: StoredState): string {
  assert.ok(state.currentRound);
  return state.currentRound.id;
}

test("抽签等待投影不泄露词，双方抽好后揭晓才返回两张卡", () => {
  const state = pairedState();
  applyDraw(state, "user-a", new Date(0), () => 0);
  applyDraw(state, "user-a", new Date(0), () => 1);
  assert.equal(state.currentRound?.cards.length, 1);

  const waiting = toAppState(
    { id: "space", name: "测试", version: 0, state: "" },
    state,
    "user-a",
    "甲",
  );
  assert.equal(waiting.round?.ownDrawn, true);
  assert.equal(waiting.round?.partnerDrawn, false);
  assert.equal("cards" in (waiting.round ?? {}), false);
  assert.equal(JSON.stringify(waiting).includes("第一条测试灵感"), false);

  applyDraw(state, "user-b", new Date(0), () => 0);
  assert.equal(state.currentRound?.cards.length, 2);
  assert.notEqual(state.currentRound?.cards[0]?.id, state.currentRound?.cards[1]?.id);
  applyReveal(state, "user-a", roundId(state));
  applyReveal(state, "user-b", roundId(state));

  const revealed = toAppState(
    { id: "space", name: "测试", version: 1, state: "" },
    state,
    "user-a",
    "甲",
  );
  assert.equal(revealed.round?.cards?.length, 2);
  assert.equal(revealed.round?.cards?.[0]?.text, "第一条测试灵感");
});

test("揭晓后的最终选择具有幂等性，另一张卡冲突且不能覆盖", () => {
  const state = pairedState();
  applyDraw(state, "user-a", undefined, () => 0);
  applyDraw(state, "user-b", undefined, () => 0);
  applyReveal(state, "user-a", roundId(state));
  const first = state.currentRound?.cards[0]?.id;
  const second = state.currentRound?.cards[1]?.id;
  assert.ok(first);
  assert.ok(second);

  const proposalId = "selection-first";
  applySelect(state, "user-a", roundId(state), first, proposalId);
  assert.equal(state.currentRound?.proposal?.id, proposalId);
  assert.throws(
    () => applyRespond(state, "user-a", roundId(state), proposalId, "approve"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "proposal_proposer_cannot_respond",
  );
  assert.throws(
    () => applySelect(state, "user-b", roundId(state), second, "selection-second"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "proposal_pending",
  );
  applyRespond(state, "user-b", roundId(state), proposalId, "approve");
  assert.equal(state.currentRound?.selectedCardId, first);
  assert.throws(
    () => applySelect(state, "user-b", roundId(state), second, "selection-second"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "round_not_revealed",
  );
  applySelect(state, "user-a", roundId(state), first, proposalId);
  assert.equal(state.currentRound?.selectedCardId, first);
});

test("提案拒绝后可以提出新提案，旧身份重放或改载荷都不能越过共识", () => {
  const state = pairedState();
  applyDraw(state, "user-a", undefined, () => 0);
  applyDraw(state, "user-b", undefined, () => 0);
  applyReveal(state, "user-a", roundId(state));
  const [first, second] = state.currentRound!.cards;

  applySelect(state, "user-a", roundId(state), first.id, "proposal-old");
  assert.throws(
    () => applyRespond(state, "user-b", roundId(state), "proposal-old", "withdraw"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "proposal_only_proposer_can_withdraw",
  );
  applyRespond(state, "user-b", roundId(state), "proposal-old", "decline");
  assert.equal(state.currentRound?.proposal, null);
  assert.throws(
    () => applySelect(state, "user-a", roundId(state), second.id, "proposal-old"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "proposal_identity_conflict",
  );
  applySelect(state, "user-a", roundId(state), second.id, "proposal-new");
  assert.throws(
    () => applySelect(state, "user-a", roundId(state), first.id, "proposal-old"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "proposal_pending",
  );
  applyRespond(state, "user-b", roundId(state), "proposal-new", "approve");
  applyRespond(state, "user-b", roundId(state), "proposal-new", "approve");
  assert.equal(state.currentRound?.selectedCardId, second.id);
});

test("重新抽签需要双方同意，批准后替换为两张隐藏新卡并保留旧轮次重放元数据", () => {
  const state = pairedState();
  applyLibraryMutation(state, "user-a", {
    action: "bulkAdd",
    texts: ["重新抽签备选一", "重新抽签备选二"],
    activate: true,
  });
  applyDraw(state, "user-a", undefined, () => 0);
  applyDraw(state, "user-b", undefined, () => 0);
  applyReveal(state, "user-a", roundId(state));
  const oldRoundId = roundId(state);
  const oldCardIds = new Set(state.currentRound!.cards.map((card) => card.id));
  applyRedraw(state, "user-a", oldRoundId, "redraw-one");
  assert.equal(state.currentRound?.proposal?.kind, "redraw");
  assert.throws(
    () => applyRespond(state, "user-a", oldRoundId, "redraw-one", "approve"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "proposal_proposer_cannot_respond",
  );
  applyRespond(state, "user-b", oldRoundId, "redraw-one", "approve");
  assert.ok(state.currentRound);
  assert.notEqual(state.currentRound.id, oldRoundId);
  assert.equal(state.currentRound.status, "ready");
  assert.equal(state.currentRound.cards.length, 2);
  assert.equal(state.currentRound.proposal, null);
  assert.equal(state.currentRound.cards.every((card) => !oldCardIds.has(card.id)), true);
  assert.equal(new Set(state.currentRound.cards.map((card) => card.ownerId)).size, 2);
  for (const card of state.currentRound.cards) {
    assert.equal(state.library.find((item) => item.id === card.id)?.held, true);
  }
  for (const cardId of oldCardIds) {
    const item = state.library.find((candidate) => candidate.id === cardId);
    assert.equal(item?.held, false);
    assert.equal(item?.state, "active");
  }
  const oldRound = state.roundHistory?.find((round) => round.id === oldRoundId);
  assert.equal(oldRound?.status, "cancelled");
  assert.equal(oldRound?.cancelledReason, "redraw");
  assert.equal(oldRound?.proposalHistory?.[0]?.id, "redraw-one");
  assert.equal(oldRound?.proposalHistory?.[0]?.replacementRoundId, state.currentRound.id);

  const replayRoundId = state.currentRound.id;
  applyRespond(state, "user-b", oldRoundId, "redraw-one", "approve");
  assert.equal(state.currentRound.id, replayRoundId);
  assert.throws(
    () => applyRespond(state, "user-b", oldRoundId, "redraw-one", "decline"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "proposal_resolved",
  );
  const projected = toAppState(
    { id: "space", name: "测试", version: 1, state: "" },
    state,
    "user-a",
    "甲",
  );
  assert.equal(projected.round?.status, "ready");
  assert.equal("cards" in (projected.round ?? {}), false);
  assert.equal(JSON.stringify(projected).includes("重新抽签备选"), false);
});

test("重新抽签候选不足时不改变提案、原卡或占用状态", () => {
  const state = pairedState();
  applyDraw(state, "user-a", undefined, () => 0);
  applyDraw(state, "user-b", undefined, () => 0);
  applyReveal(state, "user-a", roundId(state));
  const oldRoundId = roundId(state);
  applyRedraw(state, "user-a", oldRoundId, "redraw-insufficient");
  const before = serializeState(state);
  assert.throws(
    () => applyRespond(state, "user-b", oldRoundId, "redraw-insufficient", "approve"),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "not_enough_redraw_items",
  );
  assert.equal(serializeState(state), before);
  assert.equal(state.currentRound?.proposal?.id, "redraw-insufficient");
  assert.equal(state.currentRound?.cards.every((card) => state.library.find((item) => item.id === card.id)?.held), true);
});

test("带待核对或使用确认标记的导入条目不能启用，确认编辑后才可启用", () => {
  const state = pairedState();
  applyLibraryMutation(state, "user-a", {
    action: "import",
    items: [
      {
        sourceId: "photo-1",
        text: null,
        tentativeText: "照片里的候选文字",
        readingStatus: "needs_confirmation",
        needsUsageConfirmation: true,
        source: "photo",
      },
    ],
  });
  const imported = state.library.find((item) => item.sourceId === "photo-1");
  assert.ok(imported);
  assert.throws(
    () => applyLibraryMutation(state, "user-a", { action: "activate", ids: [imported.id] }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "confirmation_required",
  );

  applyLibraryMutation(state, "user-a", {
    action: "edit",
    id: imported.id,
    text: "核对后的灵感",
    confirmReading: true,
  });
  applyLibraryMutation(state, "user-a", { action: "activate", ids: [imported.id] });
  assert.equal(state.library.find((item) => item.id === imported.id)?.state, "active");
});

test("批量启用只影响请求条目，重复启用保持幂等", () => {
  const state = pairedState();
  const reserveItems = state.library.filter((item) => item.state === "reserve");
  const selected = reserveItems.slice(0, 2);
  const untouched = reserveItems[2];
  assert.equal(selected.length, 2);
  assert.ok(untouched);

  applyLibraryMutation(state, "user-a", {
    action: "activate",
    ids: selected.map((item) => item.id),
  }, 100);
  assert.deepEqual(selected.map((item) => item.state), ["active", "active"]);
  assert.equal(untouched.state, "reserve");
  const afterFirst = serializeState(state);
  applyLibraryMutation(state, "user-b", {
    action: "activate",
    ids: [selected[0].id, selected[1].id, selected[0].id],
  }, 100);
  assert.equal(serializeState(state), afterFirst);
});

test("批量启用先校验全部条目，待核对、占用或缺失项都不会部分写入", () => {
  const state = pairedState();
  const valid = state.library.find((item) => item.state === "reserve")!;
  applyLibraryMutation(state, "user-a", {
    action: "import",
    items: [{ sourceId: "batch-pending", text: null, tentativeText: "待核对", readingStatus: "needs_confirmation" }],
  });
  const pending = state.library.find((item) => item.sourceId === "batch-pending")!;
  applyDraw(state, "user-a", undefined, () => 0);
  const held = state.library.find((item) => item.held)!;
  const before = serializeState(state);

  for (const invalidId of [pending.id, held.id, "missing-batch-item"]) {
    assert.throws(
      () => applyLibraryMutation(state, "user-b", { action: "activate", ids: [valid.id, invalidId] }),
      (error: unknown) => error instanceof core.ServiceError && [
        "confirmation_required",
        "item_held",
        "item_not_found",
      ].includes(error.code),
    );
    assert.equal(serializeState(state), before);
  }
});

test("重复来源 ID 导入幂等，原词重复但来源不同仍保留", () => {
  const state = pairedState();
  const payload = {
    action: "import" as const,
    items: [
      { sourceId: "same-source", text: "原始词", source: "import" as const },
      { sourceId: "different-source", text: "原始词", source: "import" as const },
    ],
  };
  applyLibraryMutation(state, "user-a", payload);
  applyLibraryMutation(state, "user-a", payload);
  const imported = state.library.filter((item) => item.text === "原始词");
  assert.equal(imported.length, 2);
  assert.deepEqual(
    exportItems(state).items.filter((item) => item.text === "原始词").map((item) => item.sourceId),
    ["same-source", "different-source"],
  );
});

test("完成保存抽签快照，选中词完成、未选词标记次日回池", () => {
  const state = pairedState();
  applyDraw(state, "user-a", undefined, () => 0);
  applyDraw(state, "user-b", undefined, () => 0);
  applyReveal(state, "user-a", roundId(state));
  const selected = state.currentRound?.cards[0];
  const other = state.currentRound?.cards[1];
  assert.ok(selected);
  assert.ok(other);
  const selectedAt = new Date("2026-10-19T12:00:00+09:00");
  const completedAt = new Date("2026-10-22T12:00:00+09:00");
  const proposalId = "completion-selection";
  applySelect(state, "user-a", roundId(state), selected.id, proposalId);
  applyRespond(state, "user-b", roundId(state), proposalId, "approve", selectedAt);
  assert.equal(
    state.library.find((item) => item.id === other.id)?.availableAfter,
    "2026-10-20",
  );
  assert.equal(state.library.find((item) => item.id === other.id)?.held, false);
  applyComplete(state, "user-b", roundId(state), completedAt);
  applyComplete(state, "user-a", roundId(state));

  assert.equal(state.library.find((item) => item.id === selected.id)?.state, "completed");
  assert.equal(state.library.find((item) => item.id === other.id)?.state, "active");
  assert.equal(
    state.library.find((item) => item.id === other.id)?.availableAfter,
    "2026-10-20",
  );
  assert.equal(state.currentRound?.status, "completed");
  assert.equal(state.currentRound?.finishedAt, completedAt.getTime());
  assert.equal(state.currentRound?.cards[0]?.text, selected.text);
});

test("完成轮次只在同一东京自然日投影，新轮开始前保留后台快照", () => {
  const state = pairedState();
  applyDraw(state, "user-a", undefined, () => 0);
  applyDraw(state, "user-b", undefined, () => 0);
  applyReveal(state, "user-a", roundId(state));
  const selected = state.currentRound?.cards[0];
  assert.ok(selected);
  const proposalId = "day-selection";
  applySelect(
    state,
    "user-a",
    roundId(state),
    selected.id,
    proposalId,
  );
  applyRespond(
    state,
    "user-b",
    roundId(state),
    proposalId,
    "approve",
    new Date("2026-10-19T23:55:00+09:00"),
  );
  applyComplete(
    state,
    "user-a",
    roundId(state),
    new Date("2026-10-20T00:05:00+09:00"),
  );

  const space = { id: "space", name: "测试", version: 1, state: "" };
  const sameDay = toAppState(
    space,
    state,
    "user-a",
    "甲",
    new Date("2026-10-20T12:00:00+09:00"),
  );
  const nextDay = toAppState(
    space,
    state,
    "user-a",
    "甲",
    new Date("2026-10-21T00:01:00+09:00"),
  );
  assert.equal(sameDay.round?.status, "completed");
  assert.equal(nextDay.round, null);

  const oldRoundId = state.currentRound?.id;
  applyDraw(state, "user-a", new Date("2026-10-21T12:00:00+09:00"), () => 0);
  assert.equal(state.roundHistory?.length, 1);
  assert.equal(state.roundHistory?.[0]?.id, oldRoundId);
  assert.equal(state.roundHistory?.[0]?.status, "completed");
  assert.equal(state.currentRound?.status, "waiting");
});

test("旧状态缺少 roundHistory 或 finishedAt 时仍可读取并保持兼容", () => {
  const state = pairedState();
  state.currentRound = {
    id: "legacy-round",
    status: "completed",
    cards: [],
    selectedCardId: null,
    version: 1,
    createdAt: 1,
  };
  const legacy = JSON.parse(serializeState(state)) as {
    currentRound: Record<string, unknown>;
    roundHistory?: unknown;
  };
  delete legacy.roundHistory;
  delete legacy.currentRound.finishedAt;
  const parsed = parseState(JSON.stringify(legacy));
  const projected = toAppState(
    { id: "space", name: "测试", version: 1, state: "" },
    parsed,
    "user-a",
    "甲",
    new Date("2026-10-21T12:00:00+09:00"),
  );
  assert.deepEqual(parsed.roundHistory, []);
  assert.equal(parsed.currentRound?.proposal, null);
  assert.deepEqual(parsed.currentRound?.proposalHistory, []);
  assert.equal(projected.round?.id, "legacy-round");
});

test("取消会释放本轮占用，重复取消幂等且不会泄露未揭晓词", () => {
  const state = pairedState();
  applyDraw(state, "user-a", undefined, () => 0);
  const heldId = state.currentRound?.cards[0]?.id;
  assert.ok(heldId);
  applyCancel(state, "user-a", roundId(state));
  applyCancel(state, "user-b", roundId(state));
  assert.equal(state.library.find((item) => item.id === heldId)?.held, false);
  const projected = toAppState(
    { id: "space", name: "测试", version: 1, state: "" },
    state,
    "user-a",
    "甲",
  );
  assert.equal("cards" in (projected.round ?? {}), false);
  assert.equal(JSON.stringify(projected).includes("第一条测试灵感"), false);
});

test("取消已选轮次时保留用户将已释放未选卡移入备用区的决定", () => {
  const state = pairedState();
  applyDraw(state, "user-a", undefined, () => 0);
  applyDraw(state, "user-b", undefined, () => 0);
  applyReveal(state, "user-a", roundId(state));
  const selected = state.currentRound?.cards[0];
  const other = state.currentRound?.cards[1];
  assert.ok(selected);
  assert.ok(other);
  const proposalId = "cancel-selection";
  applySelect(state, "user-a", roundId(state), selected.id, proposalId);
  applyRespond(
    state,
    "user-b",
    roundId(state),
    proposalId,
    "approve",
    new Date("2026-10-19T12:00:00+09:00"),
  );
  applyLibraryMutation(state, "user-a", { action: "reserve", ids: [other.id] });
  applyCancel(state, "user-b", roundId(state));

  const selectedItem = state.library.find((item) => item.id === selected.id);
  const otherItem = state.library.find((item) => item.id === other.id);
  assert.equal(selectedItem?.state, "active");
  assert.equal(selectedItem?.held, false);
  assert.equal(otherItem?.state, "reserve");
  assert.equal(otherItem?.availableAfter, null);
});

test("完成所选灵感时保留用户将未选卡移入备用区的决定", () => {
  const state = pairedState();
  applyDraw(state, "user-a", undefined, () => 0);
  applyDraw(state, "user-b", undefined, () => 0);
  applyReveal(state, "user-a", roundId(state));
  const [selected, other] = state.currentRound!.cards;
  const proposalId = "reserve-selection";
  applySelect(state, "user-a", roundId(state), selected.id, proposalId);
  applyRespond(state, "user-b", roundId(state), proposalId, "approve");
  applyLibraryMutation(state, "user-b", { action: "reserve", ids: [other.id] });
  applyComplete(state, "user-a", roundId(state));
  assert.equal(state.library.find((item) => item.id === selected.id)?.state, "completed");
  assert.equal(state.library.find((item) => item.id === other.id)?.state, "reserve");
});

test("旧回应不能批准新的邀请，取消待回应轮次也不会留下可执行提案", () => {
  const state = pairedState();
  applyLibraryMutation(state, "user-a", { action: "bulkAdd", texts: ["替代甲", "替代乙"], activate: true });
  applyDraw(state, "user-a", undefined, () => 0);
  applyDraw(state, "user-b", undefined, () => 0);
  const id = roundId(state);
  applyReveal(state, "user-a", id);
  const first = state.currentRound!.cards[0];
  applySelect(state, "user-a", id, first.id, "old-declined");
  applyRespond(state, "user-b", id, "old-declined", "decline");
  applyRedraw(state, "user-a", id, "new-redraw");
  const before = serializeState(state);
  applyRespond(state, "user-b", id, "old-declined", "decline");
  assert.equal(serializeState(state), before);
  assert.throws(() => applyRespond(state, "user-b", id, "old-declined", "approve"));
  assert.equal(serializeState(state), before);
  assert.throws(() => applyRespond(state, "user-a", id, "new-redraw", "approve"));
  assert.equal(serializeState(state), before);
  applyCancel(state, "user-b", id);
  assert.equal(state.currentRound?.proposal, null);
  assert.throws(() => applyRespond(state, "user-b", id, "new-redraw", "approve"));
  assert.equal(state.library.filter((item) => item.held).length, 0);
  assert.equal(state.currentRound?.status, "cancelled");
});

test("编辑保留条目状态与来源备注，active 与 reserve 删除幂等", () => {
  const state = pairedState();
  const target = state.library.find((item) => item.state === "active")!;
  applyLibraryMutation(state, "user-a", { action: "edit", id: target.id, text: "更新后的合成灵感", confirmReading: false });
  assert.equal(target.text, "更新后的合成灵感");
  assert.equal(target.state, "active");
  const beforeInvalid = serializeState(state);
  assert.throws(() => applyLibraryMutation(state, "user-b", { action: "edit", id: target.id, text: "  ", confirmReading: false }));
  assert.equal(serializeState(state), beforeInvalid);
  assert.throws(() => applyLibraryMutation(state, "outsider", { action: "delete", id: target.id }));
  assert.equal(serializeState(state), beforeInvalid);
  applyLibraryMutation(state, "user-b", { action: "delete", id: target.id });
  const after = serializeState(state);
  applyLibraryMutation(state, "user-a", { action: "delete", id: target.id });
  assert.equal(serializeState(state), after);
  assert(!exportItems(state).items.some((item) => item.text === target.text));

  applyLibraryMutation(state, "user-a", {
    action: "import",
    items: [{ sourceId: "reserve-edit-source", text: "备用原词", notes: "备用备注", source: "import" }],
  });
  const reserve = state.library.find((item) => item.sourceId === "reserve-edit-source");
  assert.ok(reserve);
  assert.equal(reserve.state, "reserve");
  applyLibraryMutation(state, "user-b", {
    action: "edit",
    id: reserve.id,
    text: "更新后的备用词",
    confirmReading: false,
  });
  assert.equal(reserve.text, "更新后的备用词");
  assert.equal(reserve.state, "reserve");
  assert.equal(reserve.sourceId, "reserve-edit-source");
  assert.equal(reserve.notes, "备用备注");
  applyLibraryMutation(state, "user-a", { action: "delete", id: reserve.id });
  const afterReserveDelete = serializeState(state);
  applyLibraryMutation(state, "user-b", { action: "delete", id: reserve.id });
  assert.equal(serializeState(state), afterReserveDelete);
  assert.equal(state.library.some((item) => item.id === reserve.id), false);

  applyDraw(state, "user-a", undefined, () => 0);
  applyDraw(state, "user-b", undefined, () => 0);
  assert(!state.currentRound?.cards.some((card) => card.id === target.id));
});

test("占用条目禁止编辑和删除，已完成条目禁止删除", () => {
  const state = pairedState();
  applyDraw(state, "user-a", undefined, () => 0);
  const held = state.currentRound!.cards[0];
  const before = serializeState(state);
  for (const mutation of [
    { action: "delete" as const, id: held.id },
    { action: "edit" as const, id: held.id, text: "不应生效", confirmReading: false },
  ]) {
    assert.throws(() => applyLibraryMutation(state, "user-b", mutation),
      (error: unknown) => error instanceof core.ServiceError && error.code === "item_held");
    assert.equal(serializeState(state), before);
  }

  applyDraw(state, "user-b", undefined, () => 0);
  applyReveal(state, "user-a", roundId(state));
  const selected = state.currentRound!.cards[0];
  applySelect(state, "user-a", roundId(state), selected.id, "completed-delete-protection");
  applyRespond(state, "user-b", roundId(state), "completed-delete-protection", "approve");
  applyComplete(state, "user-a", roundId(state));
  const completed = state.library.find((item) => item.id === selected.id)!;
  assert.equal(completed.state, "completed");
  const beforeCompletedDelete = serializeState(state);
  assert.throws(
    () => applyLibraryMutation(state, "user-a", { action: "delete", id: completed.id }),
    (error: unknown) => error instanceof core.ServiceError && error.code === "item_not_deletable",
  );
  assert.equal(serializeState(state), beforeCompletedDelete);
});

for (const finish of ["complete", "cancel"] as const) {
  test(`删除已释放未选卡后仍可${finish === "complete" ? "完成" : "取消"}，并保留原抽签快照`, () => {
    const state = pairedState();
    applyDraw(state, "user-a", undefined, () => 0);
    applyDraw(state, "user-b", undefined, () => 0);
    const id = roundId(state);
    applyReveal(state, "user-a", id);
    const [selected, other] = state.currentRound!.cards;
    const snapshot = JSON.stringify(state.currentRound!.cards);
    applySelect(state, "user-a", id, selected.id, "selection-before-delete");
    applyRespond(state, "user-b", id, "selection-before-delete", "approve");
    applyLibraryMutation(state, "user-a", { action: "delete", id: other.id });
    assert.equal(JSON.stringify(state.currentRound!.cards), snapshot);
    if (finish === "complete") applyComplete(state, "user-b", id);
    else applyCancel(state, "user-b", id);
    assert.equal(state.currentRound?.status, finish === "complete" ? "completed" : "cancelled");
    assert.equal(state.library.some((item) => item.id === other.id), false);
    assert.equal(JSON.stringify(state.currentRound!.cards), snapshot);
    assert.equal(state.library.filter((item) => item.held).length, 0);
  });
}
