import assert from "node:assert/strict";

const base = (process.argv[2] || "http://127.0.0.1:5273").replace(/\/$/, "");
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname), "仅运行于本机测试服务");
let checks = 0;
function passed(label) { checks += 1; console.log(`✓ ${label}`); }

async function actor() {
  let cookie = "";
  const client = {
    async request(path, body, origin = base) {
      const headers = { accept: "application/json" };
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) {
        headers["content-type"] = "application/json";
        if (origin !== null) headers.origin = origin;
      }
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const responseText = await response.text();
      let value;
      try { value = JSON.parse(responseText); }
      catch {
        assert(!response.ok, `${path} 成功响应必须是 JSON`);
        value = { error: responseText };
      }
      return { status: response.status, value, cache: response.headers.get("cache-control") };
    },
    async ok(path, body) {
      const result = await this.request(path, body);
      assert.equal(result.status, 200, `${path}: ${JSON.stringify(result.value)}`);
      assert.equal(result.cache, "no-store");
      return result.value;
    },
  };
  client.initial = await client.ok("/api/state");
  return client;
}

const owner = await actor();
const partner = await actor();
const outsider = await actor();
assert.notEqual(owner.initial.viewer.id, partner.initial.viewer.id);
assert.equal(owner.initial.space, null);
passed("两个客户端持有不同服务端生成的设备身份");

await owner.ok("/api/space", { name: "本机自动验证空间" });
const invite = await owner.ok("/api/invite", {});
const joined = await partner.ok("/api/join", { token: invite.token, name: "验证伙伴" });
assert.equal(joined.space.paired, true);
assert.equal((await owner.ok("/api/state")).space.id, joined.space.id);
assert((await outsider.request("/api/join", { token: invite.token })).status >= 400);
assert((await outsider.request("/api/library")).status >= 400);
assert.equal((await outsider.ok("/api/state")).space, null);
passed("一次性配对、第三人隔离与空间一致性");

const imported = [
  { sourceId: "qa-repeat-a", text: "同一个词", source: "import" },
  { sourceId: "qa-repeat-b", text: "同一个词", source: "import" },
  { sourceId: "qa-reading", text: null, tentativeText: "仅为暂读", readingStatus: "needs_confirmation" },
  { sourceId: "qa-mark", text: "有划线的词", needsUsageConfirmation: true },
  { sourceId: "qa-reserve-edit", text: "备用待编辑词", notes: "备用条目备注", source: "import" },
  { sourceId: "qa-reserve-delete", text: "备用待删除词", notes: "删除条目备注", source: "import" },
];
let library = await owner.ok("/api/library", { action: "import", items: imported });
assert(imported.every((source) => library.items.find((item) => item.sourceId === source.sourceId)?.state === "reserve"));
const total = library.items.length;
library = await owner.ok("/api/library", { action: "import", items: imported });
assert.equal(library.items.length, total);
assert.equal(library.items.filter((item) => item.text === "同一个词").length, 2);
for (const sourceId of ["qa-reading", "qa-mark"]) {
  const item = library.items.find((entry) => entry.sourceId === sourceId);
  assert((await owner.request("/api/library", { action: "activate", ids: [item.id] })).status >= 400);
}
const pending = library.items.find((entry) => entry.sourceId === "qa-reading");
await owner.ok("/api/library", { action: "edit", id: pending.id, text: "人工核对的合成测试词", confirmReading: true });
const reserveEdit = library.items.find((entry) => entry.sourceId === "qa-reserve-edit");
const reserveDelete = library.items.find((entry) => entry.sourceId === "qa-reserve-delete");
assert.equal(reserveEdit.state, "reserve");
assert.equal(reserveDelete.state, "reserve");
await owner.ok("/api/library", { action: "edit", id: reserveEdit.id, text: "更新后的备用合成词", confirmReading: false });
const sharedReserve = (await partner.ok("/api/library")).items.find((entry) => entry.id === reserveEdit.id);
assert.equal(sharedReserve.text, "更新后的备用合成词");
assert.equal(sharedReserve.state, "reserve");
assert.equal(sharedReserve.sourceId, "qa-reserve-edit");
assert.equal(sharedReserve.notes, "备用条目备注");
const reserveDeletions = await Promise.all([
  owner.request("/api/library", { action: "delete", id: reserveDelete.id }),
  partner.request("/api/library", { action: "delete", id: reserveDelete.id }),
]);
assert(reserveDeletions.every((result) => result.status === 200));
assert(!(await owner.ok("/api/library")).items.some((item) => item.id === reserveDelete.id));
assert(!(await partner.ok("/api/export")).items.some((item) => item.sourceId === "qa-reserve-delete"));
passed("导入默认备用、重复来源幂等、reserve 编辑/删除双端共享与待核对限制");

const batchAdded = await owner.ok("/api/library", {
  action: "bulkAdd",
  texts: ["批量启用合成甲", "批量启用合成乙", "保持备用合成丙"],
  activate: false,
});
const batchItems = batchAdded.items.filter((item) => ["批量启用合成甲", "批量启用合成乙", "保持备用合成丙"].includes(item.text));
assert.equal(batchItems.length, 3);
assert(batchItems.every((item) => item.state === "reserve"));
const batchIds = batchItems.filter((item) => item.text !== "保持备用合成丙").map((item) => item.id);
const untouchedBatch = batchItems.find((item) => item.text === "保持备用合成丙");
const batchActivation = { action: "activate", ids: batchIds };
const activationRace = await Promise.all([
  owner.request("/api/library", batchActivation),
  partner.request("/api/library", batchActivation),
]);
assert(activationRace.every((result) => result.status === 200));
await owner.ok("/api/library", batchActivation);
await partner.ok("/api/library", batchActivation);
library = await owner.ok("/api/library");
assert(batchIds.every((id) => library.items.find((item) => item.id === id)?.state === "active"));
assert.equal(library.items.find((item) => item.id === untouchedBatch.id)?.state, "reserve");

const pendingBatch = library.items.find((item) => item.sourceId === "qa-mark");
const reserveSnapshot = new Map(
  [untouchedBatch.id, pendingBatch.id].map((id) => {
    const item = library.items.find((entry) => entry.id === id);
    return [id, { state: item.state, held: item.held, text: item.text }];
  }),
);
assert.equal((await owner.request("/api/library", { action: "activate", ids: [untouchedBatch.id, pendingBatch.id] })).status, 409);
assert.equal((await owner.request("/api/library", { action: "activate", ids: [untouchedBatch.id, "missing-batch-item"] })).status, 404);
library = await owner.ok("/api/library");
for (const [id, snapshot] of reserveSnapshot) {
  const item = library.items.find((entry) => entry.id === id);
  assert.deepEqual({ state: item.state, held: item.held, text: item.text }, snapshot);
}
passed("批量启用只作用于指定条目，重复/并发请求幂等，无效待核对或缺失条目不部分写入");

const poolEntry = (await owner.ok("/api/library", { action: "add", text: "可抽池编辑删除合成词", activate: true })).items.find((item) => item.text === "可抽池编辑删除合成词");
assert(poolEntry);
await owner.ok("/api/library", { action: "edit", id: poolEntry.id, text: "修改后的可抽池合成词", confirmReading: false });
assert.equal((await partner.ok("/api/library")).items.find((item) => item.id === poolEntry.id).text, "修改后的可抽池合成词");
assert.equal((await outsider.request("/api/library", { action: "delete", id: poolEntry.id })).status, 401);
assert.equal((await owner.request("/api/library", { action: "delete", id: "" })).status, 400);
const deletions = await Promise.all([
  owner.request("/api/library", { action: "delete", id: poolEntry.id }),
  partner.request("/api/library", { action: "delete", id: poolEntry.id }),
]);
assert(deletions.every((result) => result.status === 200));
assert(!(await owner.ok("/api/library")).items.some((item) => item.id === poolEntry.id));
assert(!(await partner.ok("/api/export")).items.some((item) => item.text === "修改后的可抽池合成词"));
passed("可抽池编辑双端共享，删除并发幂等、输入与成员校验，删除内容不进入导出");

await owner.ok("/api/library", { action: "bulkAdd", texts: ["本轮测试词甲", "本轮测试词乙"], activate: true });
let state = await owner.ok("/api/draw", {});
const roundId = state.round.id;
assert.equal(state.round.status, "waiting");
assert.equal("cards" in state.round, false);
assert.equal(state.round.selectedText, null);
assert.equal((await owner.ok("/api/draw", {})).round.id, roundId);
assert.equal((await owner.ok("/api/state")).round.id, roundId);
assert((await owner.request("/api/reveal", { roundId })).status >= 400);
const heldEntry = (await owner.ok("/api/library")).items.find((item) => item.held);
assert(heldEntry);
assert.equal((await partner.request("/api/library", { action: "delete", id: heldEntry.id })).status, 409);
assert.equal((await partner.request("/api/library", { action: "edit", id: heldEntry.id, text: "不应改写占用条目", confirmReading: false })).status, 409);
assert.equal((await owner.ok("/api/library")).items.find((item) => item.id === heldEntry.id).text, heldEntry.text);
assert.equal((await owner.request("/api/library", { action: "activate", ids: [untouchedBatch.id, heldEntry.id] })).status, 409);
library = await owner.ok("/api/library");
assert.equal(library.items.find((item) => item.id === untouchedBatch.id)?.state, "reserve");
assert.equal(library.items.find((item) => item.id === heldEntry.id)?.held, true);

state = await partner.ok("/api/draw", {});
assert.equal(state.round.id, roundId);
assert.equal(state.round.status, "ready");
assert.equal("cards" in state.round, false);
passed("等待时不返回候选词，重试与刷新不换签，未齐不能揭晓");

const revealed = await owner.ok("/api/reveal", { roundId });
assert.equal(revealed.round.status, "revealed");
assert.equal(revealed.round.cards.length, 2);
assert.equal(new Set(revealed.round.cards.map((card) => card.id)).size, 2);
assert.equal(revealed.round.selectedCardId, null);
const otherView = await partner.ok("/api/state");
assert.deepEqual(new Set(otherView.round.cards.map((card) => card.id)), new Set(revealed.round.cards.map((card) => card.id)));
assert.equal(otherView.round.cards.filter((card) => card.owner === "self").length, 1);
passed("服务端共同揭晓两张不同纸条，初始没有默认选择");

const [first, second] = revealed.round.cards;
assert.equal((await owner.request("/api/select", { roundId, cardId: first.id })).status, 400);
const raced = await Promise.all([
  owner.request("/api/select", { roundId, cardId: first.id, proposalId: "selection-owner" }),
  partner.request("/api/select", { roundId, cardId: second.id, proposalId: "selection-partner" }),
]);
assert.deepEqual(raced.map((result) => result.status).sort(), [200, 409]);
const proposalView = await owner.ok("/api/state");
assert(proposalView.round.proposal);
assert.equal(proposalView.round.selectedCardId, null);
const proposal = proposalView.round.proposal;
const proposer = proposal.requestedBy === "self" ? owner : partner;
const responder = proposal.requestedBy === "self" ? partner : owner;
const approved = await responder.ok("/api/respond", {
  roundId,
  proposalId: proposal.id,
  action: "approve",
});
assert.equal(approved.round.selectedCardId, proposal.cardId);
const chosen = await proposer.ok("/api/select", {
  roundId,
  cardId: proposal.cardId,
  proposalId: proposal.id,
});
assert.equal(chosen.round.selectedCardId, proposal.cardId);
assert.equal(chosen.round.selectedCardId, (await partner.ok("/api/state")).round.selectedCardId);
passed("两个成员同时提交不同选择，只保留一份提案；双方批准与原请求重放幂等");

await owner.ok("/api/complete", { roundId });
assert.equal((await partner.ok("/api/complete", { roundId })).round.status, "completed");
library = await owner.ok("/api/library");
assert.equal(library.items.find((item) => item.id === chosen.round.selectedCardId).state, "completed");
assert(library.items.find((item) => item.id !== chosen.round.selectedCardId && [first.id, second.id].includes(item.id)).availableAfter);
assert.equal(library.items.filter((item) => item.held).length, 0);
passed("完成与选定分离，已做词移出、另一张保留回池日期");

await owner.ok("/api/library", {
  action: "bulkAdd",
  texts: ["重新抽签合成备选一", "重新抽签合成备选二", "重新抽签合成备选三", "重新抽签合成备选四"],
  activate: true,
});
const redrawRoundId = (await owner.ok("/api/draw", {})).round.id;
await partner.ok("/api/draw", {});
const redrawReveal = await owner.ok("/api/reveal", { roundId: redrawRoundId });
const oldRedrawCards = redrawReveal.round.cards;
const redrawRace = await Promise.all([
  owner.request("/api/redraw", { roundId: redrawRoundId, proposalId: "redraw-owner" }),
  partner.request("/api/redraw", { roundId: redrawRoundId, proposalId: "redraw-partner" }),
]);
assert.deepEqual(redrawRace.map((result) => result.status).sort(), [200, 409]);
const redrawProposalView = await owner.ok("/api/state");
assert.equal(redrawProposalView.round.status, "revealed");
assert(redrawProposalView.round.proposal);
const redrawProposal = redrawProposalView.round.proposal;
const redrawProposer = redrawProposal.requestedBy === "self" ? owner : partner;
const redrawResponder = redrawProposal.requestedBy === "self" ? partner : owner;
const redrawApprovalPayload = {
  roundId: redrawRoundId,
  proposalId: redrawProposal.id,
  action: "approve",
};
const redrawApprovals = await Promise.all([
  redrawResponder.request("/api/respond", redrawApprovalPayload),
  redrawResponder.request("/api/respond", redrawApprovalPayload),
]);
assert.deepEqual(redrawApprovals.map((result) => result.status).sort(), [200, 200]);
const afterRedraw = await redrawProposer.ok("/api/state");
assert.equal(afterRedraw.round.status, "ready");
assert.notEqual(afterRedraw.round.id, redrawRoundId);
assert.equal("cards" in afterRedraw.round, false);
assert.equal(JSON.stringify(afterRedraw).includes("重新抽签合成备选"), false);
const redrawReplay = await redrawResponder.ok("/api/respond", redrawApprovalPayload);
assert.equal(redrawReplay.round.id, afterRedraw.round.id);
assert.equal((await redrawResponder.request("/api/respond", { ...redrawApprovalPayload, action: "decline" })).status, 409);
library = await owner.ok("/api/library");
for (const card of oldRedrawCards) {
  const item = library.items.find((entry) => entry.id === card.id);
  assert.equal(item.held, false);
  assert.equal(item.state, "active");
}
assert.equal(library.items.filter((item) => item.held).length, 2);
passed("并发 redraw 提案只保留一份，批准重试安全、旧卡回池且替代轮次保持保密");

await owner.ok("/api/library", { action: "bulkAdd", texts: ["取消轮测试一", "取消轮测试二"], activate: true });
const cancelId = (await owner.ok("/api/draw", {})).round.id;
await partner.ok("/api/draw", {});
await owner.ok("/api/cancel", { roundId: cancelId });
assert.equal((await partner.ok("/api/cancel", { roundId: cancelId })).round.status, "cancelled");
assert.equal((await owner.ok("/api/library")).items.filter((item) => item.held).length, 0);
assert.equal((await owner.request("/api/draw", {}, "https://wrong-origin.invalid")).status, 403);
assert.equal((await owner.request("/api/draw", {}, null)).status, 403);
const backup = await owner.ok("/api/export");
assert(Array.isArray(backup.items));
assert.equal("token" in backup, false);
passed("取消释放与重试、跨源写入拒绝、灵感导出");

const decisionRaceId = (await owner.ok("/api/draw", {})).round.id;
await partner.ok("/api/draw", {});
const decisionRace = await owner.ok("/api/reveal", { roundId: decisionRaceId });
const decisionPayload = { roundId: decisionRaceId, proposalId: "approve-withdraw-race" };
await owner.ok("/api/select", { ...decisionPayload, cardId: decisionRace.round.cards[0].id });
const responses = await Promise.all([
  owner.request("/api/respond", { ...decisionPayload, action: "withdraw" }),
  partner.request("/api/respond", { ...decisionPayload, action: "approve" }),
]);
assert.deepEqual(responses.map((result) => result.status).sort(), [200, 409]);
const decisionFinal = (await owner.ok("/api/state")).round;
assert.equal(decisionFinal.proposal, null);
assert(["revealed", "selected"].includes(decisionFinal.status));
assert.equal((await partner.ok("/api/state")).round.selectedCardId, decisionFinal.selectedCardId);
await owner.ok("/api/cancel", { roundId: decisionRaceId });
passed("真实 D1 并发批准与撤回只生效一个，双方状态一致且没有悬空邀请");

for (let iteration = 0; iteration < 3; iteration += 1) {
  const host = await actor();
  const guest = await actor();
  const challenger = await actor();
  await host.ok("/api/space", { name: "本机配对并发验证" });
  const key = await host.ok("/api/invite", {});
  const writes = Array.from({ length: 4 }, (_, index) => host.request("/api/library", {
    action: "add", text: `配对并发合成词${iteration}-${index}`, activate: false,
  }));
  const result = await Promise.all([
    ...writes,
    guest.request("/api/join", { token: key.token }),
    challenger.request("/api/join", { token: key.token }),
  ]);
  const finalHost = await host.ok("/api/state");
  const a = await guest.ok("/api/state");
  const b = await challenger.ok("/api/state");
  const admitted = [a, b].filter((value) => value.space?.id === finalHost.space.id);
  assert.equal(admitted.length, 1, `并发配对结果 ${result.map((value) => value.status).join(",")}`);
  assert.equal(finalHost.space.paired, true);
  assert.equal(admitted[0].space.paired, true);
}
passed("三轮真实D1并发：库写入与两人抢同一邀请，成员关系始终一致");

console.log(`\n${checks} 组本地 HTTP / D1 集成检查通过。测试只创建隔离的合成数据空间，没有使用真实账号或修改用户空间。`);
