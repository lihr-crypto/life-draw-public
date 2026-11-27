import type {
  AppState,
  ImportItem,
  LibraryItem,
  LibraryMutation,
  LibraryResponse,
  ProposalAction,
  ProposalKind,
  RoundProposal,
  RevealedCard,
  RoundStatus,
  SpaceView,
} from "../contracts";
export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
  }
}

export function invalidRequest(message: string): ServiceError {
  return new ServiceError(400, "invalid_request", message);
}

export const MAX_NAME_LENGTH = 80;
export const MAX_SPACE_NAME_LENGTH = 120;
export const MAX_TEXT_LENGTH = 1000;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_SOURCE_ID_LENGTH = 200;
export const MAX_LIBRARY_ITEMS = 500;
export const MAX_IMPORT_ITEMS = 300;

export type StoredMember = {
  userId: string;
  name: string;
};

export type StoredLibraryItem = LibraryItem & {
  createdAt: number;
  updatedAt: number;
};

export type StoredCard = {
  id: string;
  ownerId: string;
  text: string;
};

export type StoredProposal = {
  id: string;
  kind: ProposalKind;
  requestedBy: string;
  cardId: string | null;
};

export type ProposalResolutionAction = "approved" | "declined" | "withdrawn" | "cancelled";

export type StoredProposalResolution = StoredProposal & {
  action: ProposalResolutionAction;
  resolvedBy: string;
  resolvedAt: number;
  replacementRoundId?: string;
};

export type StoredRound = {
  id: string;
  status: RoundStatus;
  cards: StoredCard[];
  selectedCardId: string | null;
  version: number;
  createdAt: number;
  /** Added after the first release; old JSON may omit these fields. */
  selectedAt?: number;
  finishedAt?: number;
  /** Active two-member proposal; old JSON may omit this field. */
  proposal?: StoredProposal | null;
  /** Resolved proposal identities retained for idempotent retries. */
  proposalHistory?: StoredProposalResolution[];
  /** Set when redraw replaces this round. */
  cancelledReason?: "redraw";
  replacedByRoundId?: string;
};

export type StoredState = {
  schemaVersion: 1;
  members: StoredMember[];
  library: StoredLibraryItem[];
  currentRound: StoredRound | null;
  /** Internal history only; it is never included in AppState or exports. */
  roundHistory?: StoredRound[];
};

export type SpaceRecord = {
  id: string;
  name: string;
  version: number;
  state: string;
};

export const SYSTEM_INSPIRATIONS = [
  "把今天最重要的一件事写下来",
  "给一个久未联系的人发一句问候",
  "在回家路上观察三种不同的光",
  "把一个小房间整理到能立刻使用",
  "听一首从未完整听过的歌",
  "为明天提前准备一件小事",
  "记录今天让你微笑的瞬间",
  "做一道平时不会点的菜",
  "沿着熟悉的路换一个方向走",
  "读完一篇短文章并写下一句话感受",
  "拍一张没有人物的日常照片",
  "把一个拖延很久的小任务切成第一步",
  "和身边的人分享一个今天学到的词",
  "关掉通知，专心做十分钟一件事",
  "给自己的工作区留出一块空白",
  "找一个物件，写下它的来历",
  "尝试用另一只手完成一个简单动作",
  "在日落前到户外走一圈",
  "把今天的花费按类别看一遍",
  "给未来的自己留一条简短便签",
  "做三次缓慢而完整的深呼吸",
  "把一个喜欢的段落读给同伴听",
  "从书架上随机选一本书读两页",
];

function nowMillis(): number {
  return Date.now();
}

function randomId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function safeText(value: unknown, max: number, field: string): string {
  if (typeof value !== "string") throw invalidRequest(`${field} 必须是文本。`);
  const result = value.trim();
  if (!result) throw invalidRequest(`${field} 不能为空。`);
  if (result.length > max) throw invalidRequest(`${field} 过长。`);
  return result;
}

function optionalText(value: unknown, max: number, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw invalidRequest(`${field} 必须是文本。`);
  if (value.length > max) throw invalidRequest(`${field} 过长。`);
  return value.trim();
}

function optionalNullableText(
  value: unknown,
  max: number,
  field: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalidRequest(`${field} 必须是文本。`);
  const result = value.trim();
  if (!result) return null;
  if (result.length > max) throw invalidRequest(`${field} 过长。`);
  return result;
}

function ensureMember(state: StoredState, userId: string): StoredMember {
  const member = state.members.find((candidate) => candidate.userId === userId);
  if (!member) {
    throw new ServiceError(403, "not_a_member", "你不是这个空间的成员。");
  }
  return member;
}

function ensurePaired(state: StoredState): void {
  if (state.members.length !== 2) {
    throw new ServiceError(409, "space_not_paired", "等待另一位成员加入后才能抽签。");
  }
}

function isoTokyoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function todayTokyo(date = new Date()): string {
  return isoTokyoDate(date);
}

export function tomorrowTokyo(date = new Date()): string {
  return isoTokyoDate(new Date(date.getTime() + 24 * 60 * 60 * 1000));
}

export function parseState(serialized: string): StoredState {
  try {
    const parsed = JSON.parse(serialized) as StoredState;
    if (
      !parsed ||
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.members) ||
      !Array.isArray(parsed.library)
    ) {
      throw new Error("invalid state shape");
    }
    if (parsed.currentRound === undefined) parsed.currentRound = null;
    if (!Array.isArray(parsed.roundHistory)) parsed.roundHistory = [];
    const normalizeRound = (round: StoredRound | null): void => {
      if (!round) return;
      if (!Array.isArray(round.proposalHistory)) round.proposalHistory = [];
      if (round.proposal === undefined) round.proposal = null;
    };
    normalizeRound(parsed.currentRound);
    for (const round of parsed.roundHistory) normalizeRound(round);
    return parsed;
  } catch {
    throw new ServiceError(500, "invalid_persisted_state", "空间数据无法读取。");
  }
}

export function serializeState(state: StoredState): string {
  return JSON.stringify(state);
}

export function createInitialState(
  userId: string,
  memberName: string,
  createdAt = nowMillis(),
): StoredState {
  const member = { userId, name: safeText(memberName, MAX_NAME_LENGTH, "姓名") };
  const library = SYSTEM_INSPIRATIONS.map((text, index) => ({
    id: randomId("item"),
    text,
    tentativeText: null,
    state: "reserve" as const,
    readingStatus: "readable" as const,
    needsUsageConfirmation: false,
    sourceId: `system-${String(index + 1).padStart(2, "0")}`,
    source: "system" as const,
    notes: "",
    held: false,
    availableAfter: null,
    createdAt,
    updatedAt: createdAt,
  }));
  return {
    schemaVersion: 1,
    members: [member],
    library,
    currentRound: null,
    roundHistory: [],
  };
}

export function addMember(
  state: StoredState,
  userId: string,
  memberName: string,
): void {
  if (state.members.some((member) => member.userId === userId)) return;
  if (state.members.length >= 2) {
    throw new ServiceError(409, "space_full", "这个空间已经有两位成员。");
  }
  state.members.push({
    userId,
    name: safeText(memberName, MAX_NAME_LENGTH, "姓名"),
  });
}

function libraryItemView(item: StoredLibraryItem): LibraryItem {
  return {
    id: item.id,
    text: item.text,
    tentativeText: item.tentativeText,
    state: item.state,
    readingStatus: item.readingStatus,
    needsUsageConfirmation: item.needsUsageConfirmation,
    sourceId: item.sourceId,
    source: item.source,
    notes: item.notes,
    held: item.held,
    availableAfter: item.availableAfter,
  };
}

export function toLibraryResponse(state: StoredState): LibraryResponse {
  return {
    items: [...state.library]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(libraryItemView),
  };
}

function availableItems(state: StoredState, now = new Date()): StoredLibraryItem[] {
  const today = todayTokyo(now);
  return state.library.filter(
    (item) =>
      item.state === "active" &&
      !item.held &&
      item.readingStatus === "readable" &&
      !item.needsUsageConfirmation &&
      !!item.text &&
      (!item.availableAfter || item.availableAfter <= today),
  );
}

function spaceView(state: StoredState, space: SpaceRecord, userId: string): SpaceView {
  const own = ensureMember(state, userId);
  const partner = state.members.find((member) => member.userId !== userId) ?? null;
  return {
    id: space.id,
    name: space.name,
    paired: state.members.length === 2,
    ownName: own.name,
    partnerName: partner?.name ?? null,
    activeCount: availableItems(state).length,
    reserveCount: state.library.filter((item) => item.state === "reserve").length,
    pendingReviewCount: state.library.filter(
      (item) =>
        item.readingStatus === "needs_confirmation" || item.needsUsageConfirmation,
    ).length,
  };
}

function roundView(
  state: StoredState,
  userId: string,
  now = new Date(),
): AppState["round"] {
  const round = state.currentRound;
  if (!round) return null;
  // A completed round is a same-day result. Once the Tokyo calendar date has
  // advanced, let the caller start a new round instead of pinning the UI to
  // yesterday's completed result. Old records without finishedAt remain
  // visible for compatibility because their completion date is unknowable.
  if (
    round.status === "completed" &&
    round.finishedAt !== undefined &&
    todayTokyo(new Date(round.finishedAt)) < todayTokyo(now)
  ) {
    return null;
  }

  const isCancelled = round.status === "cancelled";
  const ownDrawn = isCancelled
    ? false
    : round.cards.some((card) => card.ownerId === userId);
  const partnerDrawn = isCancelled
    ? false
    : round.cards.some((card) => card.ownerId !== userId);
  const canReveal = ["revealed", "selected", "completed"].includes(round.status);
  const cards: RevealedCard[] | undefined = canReveal
    ? round.cards.map((card) => ({
        id: card.id,
        owner: card.ownerId === userId ? "self" : "partner",
        text: card.text,
      }))
    : undefined;
  const selectedCard = round.selectedCardId
    ? round.cards.find((card) => card.id === round.selectedCardId)
    : null;
  const proposal: RoundProposal | null = round.proposal
    ? {
        id: round.proposal.id,
        kind: round.proposal.kind,
        requestedBy: round.proposal.requestedBy === userId ? "self" : "partner",
        cardId: round.proposal.cardId,
      }
    : null;
  return {
    id: round.id,
    status: round.status,
    ownDrawn,
    partnerDrawn,
    ...(cards ? { cards } : {}),
    selectedCardId: isCancelled ? null : round.selectedCardId,
    selectedText: isCancelled ? null : selectedCard?.text ?? null,
    proposal,
    version: round.version,
  };
}

export function toAppState(
  space: SpaceRecord | null,
  state: StoredState | null,
  userId: string,
  viewerName: string,
  now = new Date(),
): AppState {
  if (!space || !state) {
    return { viewer: { id: userId, name: viewerName }, space: null, round: null };
  }
  const own = state.members.find((member) => member.userId === userId);
  return {
    viewer: { id: userId, name: own?.name ?? viewerName },
    space: spaceView(state, space, userId),
    round: roundView(state, userId, now),
  };
}

function findItem(state: StoredState, id: string): StoredLibraryItem {
  const item = state.library.find((candidate) => candidate.id === id);
  if (!item) throw new ServiceError(404, "item_not_found", "找不到这条灵感。");
  return item;
}

function ensureNotHeld(item: StoredLibraryItem): void {
  if (item.held) {
    throw new ServiceError(409, "item_held", "抽签进行中，暂时不能编辑这条灵感。");
  }
}

function ensureActivatable(item: StoredLibraryItem): void {
  if (item.readingStatus === "needs_confirmation" || item.needsUsageConfirmation) {
    throw new ServiceError(409, "confirmation_required", "请先核对文字并确认可以使用。");
  }
  if (!item.text) {
    throw new ServiceError(409, "confirmation_required", "请先补全这条灵感的文字。");
  }
}

function validateIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LIBRARY_ITEMS) {
    throw invalidRequest("ids 必须是非空数组。");
  }
  const ids = value.map((id) => safeText(id, 100, "id"));
  return [...new Set(ids)];
}

function importedItem(
  input: ImportItem,
  timestamp: number,
): StoredLibraryItem {
  const sourceId = input.sourceId
    ? safeText(input.sourceId, MAX_SOURCE_ID_LENGTH, "sourceId")
    : null;
  const text = optionalNullableText(input.text, MAX_TEXT_LENGTH, "text");
  const tentativeText = optionalNullableText(
    input.tentativeText,
    MAX_TEXT_LENGTH,
    "tentativeText",
  );
  const notes = optionalText(input.notes, MAX_NOTES_LENGTH, "notes");
  const readingStatus = input.readingStatus ?? (text ? "readable" : "needs_confirmation");
  if (readingStatus !== "readable" && readingStatus !== "needs_confirmation") {
    throw invalidRequest("readingStatus 无效。");
  }
  const needsUsageConfirmation = Boolean(input.needsUsageConfirmation);
  if (input.source !== undefined && input.source !== "photo" && input.source !== "import") {
    throw invalidRequest("source 无效。");
  }
  return {
    id: randomId("item"),
    text,
    tentativeText,
    state: "reserve",
    readingStatus,
    needsUsageConfirmation,
    sourceId,
    source: input.source ?? "import",
    notes,
    held: false,
    availableAfter: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function applyLibraryMutation(
  state: StoredState,
  userId: string,
  mutation: LibraryMutation,
  timestamp = nowMillis(),
): void {
  ensureMember(state, userId);
  if (!mutation || typeof mutation !== "object" || !("action" in mutation)) {
    throw invalidRequest("缺少 library action。");
  }

  switch (mutation.action) {
    case "add": {
      const text = safeText(mutation.text, MAX_TEXT_LENGTH, "text");
      state.library.push({
        id: randomId("item"),
        text,
        tentativeText: null,
        state: mutation.activate ? "active" : "reserve",
        readingStatus: "readable",
        needsUsageConfirmation: false,
        sourceId: null,
        source: "manual",
        notes: "",
        held: false,
        availableAfter: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return;
    }
    case "bulkAdd": {
      if (!Array.isArray(mutation.texts) || mutation.texts.length === 0) {
        throw invalidRequest("texts 必须是非空数组。");
      }
      if (mutation.texts.length > MAX_LIBRARY_ITEMS) {
        throw invalidRequest("一次添加的条目过多。");
      }
      for (const rawText of mutation.texts) {
        const text = safeText(rawText, MAX_TEXT_LENGTH, "text");
        state.library.push({
          id: randomId("item"),
          text,
          tentativeText: null,
          state: mutation.activate ? "active" : "reserve",
          readingStatus: "readable",
          needsUsageConfirmation: false,
          sourceId: null,
          source: "manual",
          notes: "",
          held: false,
          availableAfter: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      return;
    }
    case "activate": {
      const ids = validateIdList(mutation.ids);
      const items = ids.map((id) => findItem(state, id));
      for (const item of items) {
        ensureNotHeld(item);
        ensureActivatable(item);
      }
      for (const item of items) {
        item.state = "active";
        item.availableAfter = null;
        item.updatedAt = timestamp;
      }
      return;
    }
    case "reserve": {
      for (const id of validateIdList(mutation.ids)) {
        const item = findItem(state, id);
        ensureNotHeld(item);
        item.state = "reserve";
        item.availableAfter = null;
        item.updatedAt = timestamp;
      }
      return;
    }
    case "delete": {
      const id = safeText(mutation.id, 100, "id");
      const item = state.library.find((candidate) => candidate.id === id);
      if (!item) return; // An identical deletion may already have succeeded.
      ensureNotHeld(item);
      if (item.state !== "active" && item.state !== "reserve") {
        throw new ServiceError(409, "item_not_deletable", "只能删除未完成且未占用的灵感。");
      }
      state.library = state.library.filter((candidate) => candidate.id !== id);
      return;
    }
    case "edit": {
      const item = findItem(state, safeText(mutation.id, 100, "id"));
      ensureNotHeld(item);
      item.text = safeText(mutation.text, MAX_TEXT_LENGTH, "text");
      if (mutation.confirmReading) {
        item.readingStatus = "readable";
        item.needsUsageConfirmation = false;
        item.tentativeText = null;
      }
      item.updatedAt = timestamp;
      return;
    }
    case "import": {
      if (!Array.isArray(mutation.items) || mutation.items.length === 0) {
        throw invalidRequest("items 必须是非空数组。");
      }
      if (mutation.items.length > MAX_IMPORT_ITEMS) {
        throw invalidRequest("一次导入的条目过多。");
      }
      const importedSourceIds = new Set<string>();
      for (const input of mutation.items) {
        if (!input || typeof input !== "object") {
          throw invalidRequest("导入条目格式无效。");
        }
        const sourceId = input.sourceId?.trim();
        if (sourceId && (importedSourceIds.has(sourceId) || state.library.some((item) => item.sourceId === sourceId))) {
          continue;
        }
        if (sourceId) importedSourceIds.add(sourceId);
        state.library.push(importedItem(input, timestamp));
      }
      return;
    }
    default:
      throw invalidRequest("library action 无效。");
  }
}

function currentRound(state: StoredState, roundId: string): StoredRound {
  const round = state.currentRound;
  if (!round || round.id !== roundId) {
    throw new ServiceError(409, "round_mismatch", "这轮抽签已经更新，请刷新后重试。");
  }
  return round;
}

function cloneRound(round: StoredRound): StoredRound {
  return {
    ...round,
    cards: round.cards.map((card) => ({ ...card })),
    proposal: round.proposal ?? null,
    proposalHistory: (round.proposalHistory ?? []).map((proposal) => ({ ...proposal })),
  };
}

function cardForRound(round: StoredRound, cardId: string): StoredCard {
  const card = round.cards.find((candidate) => candidate.id === cardId);
  if (!card) throw new ServiceError(404, "card_not_found", "找不到这张抽签卡。");
  return card;
}

function proposalHistory(round: StoredRound): StoredProposalResolution[] {
  round.proposalHistory ??= [];
  return round.proposalHistory;
}

function findProposalResolution(
  round: StoredRound,
  proposalId: string,
): StoredProposalResolution | undefined {
  return proposalHistory(round).find((proposal) => proposal.id === proposalId);
}

function sameProposal(left: StoredProposal, right: StoredProposal): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.requestedBy === right.requestedBy &&
    left.cardId === right.cardId
  );
}

function proposalIdentityConflict(): ServiceError {
  return new ServiceError(
    409,
    "proposal_identity_conflict",
    "这个 proposalId 已经用于另一份提案，载荷不能修改。",
  );
}

function proposalPending(): ServiceError {
  return new ServiceError(409, "proposal_pending", "已有一份待回应的提案，请先回应或撤回。");
}

function ensureProposalId(value: string): string {
  return safeText(value, 100, "proposalId");
}

function proposalActionForResolution(action: ProposalResolutionAction): ProposalAction | null {
  switch (action) {
    case "approved":
      return "approve";
    case "declined":
      return "decline";
    case "withdrawn":
      return "withdraw";
    default:
      return null;
  }
}

function canReplayResolution(
  resolution: StoredProposalResolution,
  userId: string,
  action: ProposalAction,
): boolean {
  return (
    resolution.resolvedBy === userId &&
    proposalActionForResolution(resolution.action) === action
  );
}

function recordProposalResolution(
  round: StoredRound,
  proposal: StoredProposal,
  action: ProposalResolutionAction,
  resolvedBy: string,
  resolvedAt: number,
  replacementRoundId?: string,
): void {
  proposalHistory(round).push({
    ...proposal,
    action,
    resolvedBy,
    resolvedAt,
    ...(replacementRoundId ? { replacementRoundId } : {}),
  });
  round.proposal = null;
}

function checkProposalCreate(
  round: StoredRound,
  proposal: StoredProposal,
): "new" | "active_duplicate" | "resolved_duplicate" {
  if (round.proposal) {
    if (sameProposal(round.proposal, proposal)) return "active_duplicate";
    if (round.proposal.id === proposal.id) throw proposalIdentityConflict();
    throw proposalPending();
  }
  const resolved = findProposalResolution(round, proposal.id);
  if (!resolved) return "new";
  if (!sameProposal(resolved, proposal)) throw proposalIdentityConflict();
  return "resolved_duplicate";
}

export function applyDraw(
  state: StoredState,
  userId: string,
  now = new Date(),
  chooseIndex?: (length: number) => number,
): void {
  ensureMember(state, userId);
  ensurePaired(state);
  const existing = state.currentRound;
  if (existing && !["completed", "cancelled"].includes(existing.status)) {
    if (existing.cards.some((card) => card.ownerId === userId)) return;
    if (["revealed", "selected"].includes(existing.status)) {
      throw new ServiceError(409, "round_already_revealed", "这轮抽签已经揭晓。");
    }
  }

  const candidates = availableItems(state, now);
  const startingNewRound =
    !existing || ["completed", "cancelled"].includes(existing.status);
  if (candidates.length < (startingNewRound ? 2 : 1)) {
    throw new ServiceError(409, "not_enough_items", "可抽取的灵感不足两条。");
  }
  const index = chooseIndex
    ? chooseIndex(candidates.length)
    : Math.floor(Math.random() * candidates.length);
  const item = candidates[Math.max(0, Math.min(candidates.length - 1, index))];
  item.held = true;
  item.updatedAt = nowMillis();

  if (existing && ["completed", "cancelled"].includes(existing.status)) {
    state.roundHistory ??= [];
    state.roundHistory.push(cloneRound(existing));
  }

  const round: StoredRound =
    existing && ["waiting", "ready"].includes(existing.status)
      ? existing
      : {
          id: randomId("round"),
          status: "waiting",
          cards: [],
          selectedCardId: null,
          version: 0,
          createdAt: nowMillis(),
          proposal: null,
          proposalHistory: [],
        };
  round.cards.push({ id: item.id, ownerId: userId, text: item.text as string });
  round.status = round.cards.length === 2 ? "ready" : "waiting";
  round.version += 1;
  state.currentRound = round;
}

export function applyReveal(state: StoredState, userId: string, roundId: string): void {
  ensureMember(state, userId);
  ensurePaired(state);
  const round = currentRound(state, roundId);
  if (["revealed", "selected", "completed"].includes(round.status)) return;
  if (round.status !== "ready" || round.cards.length !== 2) {
    throw new ServiceError(409, "round_not_ready", "双方抽好后才能揭晓。");
  }
  round.status = "revealed";
  round.version += 1;
}

export function applySelect(
  state: StoredState,
  userId: string,
  roundId: string,
  cardId: string,
  proposalId: string,
): void {
  ensureMember(state, userId);
  ensurePaired(state);
  const round = currentRound(state, roundId);
  const proposal: StoredProposal = {
    id: ensureProposalId(proposalId),
    kind: "selection",
    requestedBy: userId,
    cardId: safeText(cardId, 100, "cardId"),
  };
  const createResult = checkProposalCreate(round, proposal);
  if (createResult !== "new") return;
  if (!["revealed"].includes(round.status)) {
    throw new ServiceError(409, "round_not_revealed", "揭晓后才能选择。");
  }
  cardForRound(round, proposal.cardId as string);
  round.proposal = proposal;
  round.version += 1;
}

export function applyRedraw(
  state: StoredState,
  userId: string,
  roundId: string,
  proposalId: string,
): void {
  ensureMember(state, userId);
  ensurePaired(state);
  const round = currentRound(state, roundId);
  const proposal: StoredProposal = {
    id: ensureProposalId(proposalId),
    kind: "redraw",
    requestedBy: userId,
    cardId: null,
  };
  const createResult = checkProposalCreate(round, proposal);
  if (createResult !== "new") return;
  if (round.status !== "revealed") {
    throw new ServiceError(409, "round_not_revealed", "揭晓后才能重新抽签。");
  }
  if (round.cards.length !== 2) {
    throw new ServiceError(409, "round_not_ready", "双方抽好后才能重新抽签。");
  }
  round.proposal = proposal;
  round.version += 1;
}

function commitSelection(
  state: StoredState,
  round: StoredRound,
  proposal: StoredProposal,
  now: Date,
): void {
  if (round.status !== "revealed") {
    throw new ServiceError(409, "round_not_revealed", "揭晓后才能选择。");
  }
  const cardId = proposal.cardId;
  if (!cardId) throw new ServiceError(500, "invalid_proposal", "选择提案缺少卡片。");
  cardForRound(round, cardId);
  const availableAfter = tomorrowTokyo(now);
  const timestamp = now.getTime();
  for (const card of round.cards) {
    if (card.id === cardId) continue;
    const item = findItem(state, card.id);
    item.held = false;
    item.state = "active";
    item.availableAfter = availableAfter;
    item.updatedAt = timestamp;
  }
  round.selectedCardId = cardId;
  round.selectedAt = timestamp;
  round.status = "selected";
  round.version += 1;
}

function commitRedraw(
  state: StoredState,
  round: StoredRound,
  proposal: StoredProposal,
  approvingUserId: string,
  now: Date,
): void {
  if (round.status !== "revealed" || round.cards.length !== 2) {
    throw new ServiceError(409, "round_not_revealed", "揭晓后才能重新抽签。");
  }
  const replacedCardIds = new Set(round.cards.map((card) => card.id));
  const alternatives = availableItems(state, now).filter(
    (item) => !replacedCardIds.has(item.id),
  );
  if (alternatives.length < 2) {
    throw new ServiceError(
      409,
      "not_enough_redraw_items",
      "重新抽签至少需要两条其他可用灵感；原来的卡片已保留。",
    );
  }

  const firstIndex = Math.floor(Math.random() * alternatives.length);
  const first = alternatives[firstIndex];
  const remaining = alternatives.filter((_, index) => index !== firstIndex);
  const second = remaining[Math.floor(Math.random() * remaining.length)];
  if (!first || !second) {
    throw new ServiceError(409, "not_enough_redraw_items", "重新抽签至少需要两条其他可用灵感；原来的卡片已保留。");
  }

  const timestamp = now.getTime();
  for (const card of round.cards) {
    const item = findItem(state, card.id);
    item.held = false;
    item.state = "active";
    item.availableAfter = null;
    item.updatedAt = timestamp;
  }
  for (const item of [first, second]) {
    item.held = true;
    item.updatedAt = timestamp;
  }

  const replacementRoundId = randomId("round");
  recordProposalResolution(
    round,
    proposal,
    "approved",
    approvingUserId,
    timestamp,
    replacementRoundId,
  );
  round.status = "cancelled";
  round.cancelledReason = "redraw";
  round.replacedByRoundId = replacementRoundId;
  round.selectedCardId = null;
  round.version += 1;

  state.roundHistory ??= [];
  state.roundHistory.push(cloneRound(round));
  const owners = state.members.map((member) => member.userId);
  state.currentRound = {
    id: replacementRoundId,
    status: "ready",
    cards: [
      { id: first.id, ownerId: owners[0], text: first.text as string },
      { id: second.id, ownerId: owners[1], text: second.text as string },
    ],
    selectedCardId: null,
    version: 0,
    createdAt: timestamp,
    proposal: null,
    proposalHistory: [],
  };
}

export function applyRespond(
  state: StoredState,
  userId: string,
  roundId: string,
  proposalId: string,
  action: ProposalAction,
  now = new Date(),
): void {
  ensureMember(state, userId);
  ensurePaired(state);
  if (!["approve", "decline", "withdraw"].includes(action)) {
    throw invalidRequest("proposal action 无效。");
  }
  const normalizedProposalId = ensureProposalId(proposalId);
  const current = state.currentRound;
  const round = current?.id === roundId
    ? current
    : state.roundHistory?.find((candidate) => candidate.id === roundId);
  if (!round) throw new ServiceError(409, "round_mismatch", "这轮抽签已经更新，请刷新后重试。");

  const resolved = findProposalResolution(round, normalizedProposalId);
  if (current !== round) {
    if (resolved && canReplayResolution(resolved, userId, action)) return;
    throw new ServiceError(409, "proposal_resolved", "这份提案已经解决，请刷新后查看最新轮次。");
  }
  const proposal = round.proposal;
  if (!proposal || proposal.id !== normalizedProposalId) {
    if (resolved && canReplayResolution(resolved, userId, action)) return;
    throw new ServiceError(409, "proposal_resolved", "这份提案已经解决，请刷新后查看最新状态。");
  }
  if (userId === proposal.requestedBy) {
    if (action !== "withdraw") {
      throw new ServiceError(403, "proposal_proposer_cannot_respond", "提案发起人不能批准或拒绝自己的提案。");
    }
  } else if (action === "withdraw") {
    throw new ServiceError(403, "proposal_only_proposer_can_withdraw", "只有提案发起人可以撤回提案。");
  }

  const timestamp = now.getTime();
  if (action === "withdraw") {
    recordProposalResolution(round, proposal, "withdrawn", userId, timestamp);
    round.version += 1;
    return;
  }
  if (action === "decline") {
    recordProposalResolution(round, proposal, "declined", userId, timestamp);
    round.version += 1;
    return;
  }
  if (proposal.kind === "selection") {
    commitSelection(state, round, proposal, now);
    recordProposalResolution(round, proposal, "approved", userId, timestamp);
    return;
  }
  commitRedraw(state, round, proposal, userId, now);
}

export function applyComplete(
  state: StoredState,
  userId: string,
  roundId: string,
  now = new Date(),
): void {
  ensureMember(state, userId);
  ensurePaired(state);
  const round = currentRound(state, roundId);
  if (round.status === "completed") return;
  if (round.status !== "selected" || !round.selectedCardId) {
    throw new ServiceError(409, "selection_required", "先选定一张卡才能完成。");
  }
  for (const card of round.cards) {
    // The unselected item is released at selection time and may since have
    // been deleted. The round keeps its original text snapshot independently.
    const item = card.id === round.selectedCardId
      ? findItem(state, card.id)
      : state.library.find((candidate) => candidate.id === card.id);
    if (!item) continue;
    if (card.id === round.selectedCardId) {
      item.held = false;
      item.state = "completed";
      item.availableAfter = null;
      item.updatedAt = now.getTime();
    } else if (item.held) {
      // New rounds release this card during select. This branch repairs an
      // older selected round that was persisted before that behavior existed.
      // Already released cards may have been moved to reserve by a member;
      // completing the other card must preserve that explicit library choice.
      item.held = false;
      item.state = "active";
      if (!item.availableAfter) item.availableAfter = tomorrowTokyo(now);
      item.updatedAt = now.getTime();
    }
  }
  round.status = "completed";
  round.finishedAt = now.getTime();
  round.version += 1;
}

export function applyCancel(state: StoredState, userId: string, roundId: string): void {
  ensureMember(state, userId);
  ensurePaired(state);
  const round = currentRound(state, roundId);
  if (round.status === "completed") {
    throw new ServiceError(409, "round_completed", "已完成的抽签不能取消。");
  }
  if (round.status === "cancelled") return;
  const proposal = round.proposal;
  const timestamp = nowMillis();
  if (proposal) {
    recordProposalResolution(round, proposal, "cancelled", userId, timestamp);
  }
  for (const card of round.cards) {
    const item = state.library.find((candidate) => candidate.id === card.id);
    if (!item) continue; // Do not restore a released item deleted by a member.
    const wasHeld = item.held;
    const isSelected = round.selectedCardId === card.id;
    item.held = false;
    // A selected card remains held until completion/cancel, and old selected
    // rounds may still have held the other card. Those are released to active.
    // A card released during select may have been deliberately moved to
    // reserve afterwards; preserve that library decision while clearing only
    // the cooldown introduced by this round.
    if (isSelected || wasHeld) item.state = "active";
    item.availableAfter = null;
    item.updatedAt = timestamp;
  }
  round.selectedCardId = null;
  round.status = "cancelled";
  round.version += 1;
}

export function exportItems(state: StoredState): { items: ImportItem[] } {
  return {
    items: state.library.map((item) => ({
      sourceId: item.sourceId ?? `export-${item.id}`,
      text: item.text,
      tentativeText: item.tentativeText,
      readingStatus: item.readingStatus,
      needsUsageConfirmation: item.needsUsageConfirmation,
      notes: item.notes,
      source: item.source === "photo" ? "photo" : "import",
    })),
  };
}
