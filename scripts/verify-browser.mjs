import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

// Optional QA dependency: installed Playwright or the host's bundled module.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = (process.argv[2] || "http://127.0.0.1:5273").replace(/\/$/, "");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname), "只测试本机服务");
const output = ".local-reference";
await mkdir(output, { recursive: true });
const results = { checks: [], pageErrors: [], layouts: [] };
const pass = (name) => { results.checks.push(name); console.log(`✓ ${name}`); };
async function until(fn, label) {
  for (const end = Date.now() + 15000; Date.now() < end;) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
async function api(context, path, body) {
  const response = body === undefined
    ? await context.request.get(base + path)
    : await context.request.post(base + path, { data: body, headers: { Origin: base } });
  assert.equal(response.status(), 200, `${path}: ${await response.text()}`);
  return response.json();
}
async function screenshot(page, name) {
  await page.locator("img").evaluateAll(async (images) => {
    await Promise.all(images.map((image) => image.decode()));
  });
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
async function checkCards(page, label) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    cards: [...document.querySelectorAll(".result-card")].map((card) => {
      const rect = card.getBoundingClientRect();
      const text = card.querySelector(".result-card-text");
      const textRect = text.getBoundingClientRect();
      return {
        top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        width: card.offsetWidth, height: card.offsetHeight,
        textBottom: textRect.bottom, textHeight: text.clientHeight, textScrollHeight: text.scrollHeight,
        fontSize: parseFloat(getComputedStyle(text).fontSize), transform: getComputedStyle(card).transform,
      };
    }),
  }));
  results.layouts.push({ label, ...layout });
  const [first, second] = layout.cards;
  assert.equal(layout.cards.length, 2);
  assert(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
  assert(first.bottom < second.top, "两张卡必须上下排列且无重叠");
  assert.equal(first.width, second.width);
  assert.equal(first.height, second.height);
  assert.notEqual(first.transform, second.transform);
  assert(first.left < second.left, "上卡偏左，下卡偏右");
  for (const card of layout.cards) {
    assert(card.left >= 0 && card.right <= layout.width + 1, JSON.stringify(card));
    assert(card.textBottom <= card.bottom + 1 && card.textScrollHeight <= card.textHeight + 1, JSON.stringify(card));
  }
}

const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const owner = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const partner = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await owner.addInitScript(() => Object.defineProperty(navigator, "clipboard", { get: () => undefined, configurable: true }));
  const a = await owner.newPage(); const b = await partner.newPage();
  for (const page of [a, b]) {
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => results.pageErrors.push(error.message));
  }
  await a.goto(base);
  await a.getByRole("button", { name: "创建空间", exact: true }).click();
  await a.getByLabel("给这个空间起个名字（可选）").fill("合成浏览器验收空间");
  await a.getByRole("button", { name: "创建空间", exact: true }).click();
  await a.getByRole("button", { name: "生成邀请链接", exact: true }).click();
  const invite = await a.locator(".share-link-value").innerText();
  assert((await a.locator(".message-banner").innerText()).includes("手动复制"));
  await a.getByRole("button", { name: "复制链接", exact: true }).click();
  assert(!(await a.locator("body").innerText()).includes("已复制"));
  await b.goto(invite);
  await b.getByRole("button", { name: "加入空间", exact: true }).click();
  await a.locator(".paired-empty-state").waitFor();
  await until(async () => await a.locator(".message-banner").count() === 0, "过时邀请提示消失");
  assert(!b.url().includes("invite="));
  assert.equal(await a.locator(".share-link-value").count(), 0);
  pass("独立身份配对、缺少剪贴板时手动复制，配对成功清理邀请提示与链接");

  await a.getByRole("button", { name: "打开灵感库" }).click();
  assert.equal(await a.locator(".library-header .panel-kicker").count(), 0);
  assert.equal(await a.locator(".library-header h1").innerText(), "灵感库");
  await a.locator("summary").filter({ hasText: "导入 JSON" }).click();
  const fixture = { items: [
    { sourceId: "fixture-universe", text: "宇宙", notes: "可抽来源备注合成内容", source: "import" },
    { sourceId: "fixture-jazz", text: "爵士", source: "import" },
    { sourceId: "fixture-review", text: null, tentativeText: "待核对合成词", notes: "待核对备注需要保留", readingStatus: "needs_confirmation" },
    { sourceId: "fixture-usage", text: "需确认合成词", needsUsageConfirmation: true },
  ] };
  const upload = { name: "synthetic-library.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) };
  await a.locator("input[type=file]").setInputFiles(upload);
  const library = await until(async () => {
    const data = await api(owner, "/api/library");
    return data.items.filter((item) => item.sourceId?.startsWith("fixture-")).length === 4 ? data : null;
  }, "合成 JSON 导入");
  assert(library.items.filter((item) => item.sourceId?.startsWith("fixture-")).every((item) => item.state === "reserve"));
  await a.locator("input[type=file]").setInputFiles(upload);
  await a.locator(".library-section-pending .library-item-row").first().waitFor();
  assert.equal((await api(owner, "/api/library")).items.length, library.items.length);
  const field = a.getByPlaceholder("写下一件今天可能想做的小事");
  await a.route("**/api/library", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "add") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "合成网络失败" }) });
    } else await route.continue();
  });
  await field.fill("失败时保留草稿");
  await a.getByRole("button", { name: "添加", exact: true }).click();
  await a.getByText("合成网络失败", { exact: true }).waitFor();
  assert.equal(await field.inputValue(), "失败时保留草稿");
  await a.unroute("**/api/library");
  pass("合成 JSON 经界面导入并幂等，待核对标记保留；提交失败保留草稿");
  await api(owner, "/api/library", { action: "activate", ids: library.items.filter((item) => ["fixture-universe", "fixture-jazz"].includes(item.sourceId)).map((item) => item.id) });
  const poolText = "可抽池编辑删除合成词";
  const created = await api(owner, "/api/library", { action: "add", text: poolText, activate: true });
  const editable = created.items.find((item) => item.text === poolText);
  assert(editable);
  const row = a.locator(`[data-item-id="${editable.id}"]`);
  await row.waitFor();
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const editField = row.getByLabel("灵感内容");
  assert.equal(await editField.inputValue(), poolText);
  await editField.fill("");
  await row.getByRole("button", { name: "保存修改", exact: true }).click();
  await a.getByText("请填写灵感内容。", { exact: true }).waitFor();
  await editField.fill("失败后保留的修改草稿");
  await a.route("**/api/library", async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "edit") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "合成编辑失败" }) });
    } else await route.continue();
  });
  await row.getByRole("button", { name: "保存修改", exact: true }).click();
  await a.getByText("合成编辑失败", { exact: true }).waitFor();
  assert.equal(await editField.inputValue(), "失败后保留的修改草稿");
  await row.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await row.locator(".library-item-text").innerText(), poolText);
  await a.unroute("**/api/library");
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await row.getByLabel("灵感内容").fill("修改后的可抽池合成词");
  await row.getByRole("button", { name: "保存修改", exact: true }).click();
  await row.getByText("修改后的可抽池合成词", { exact: true }).waitFor();
  assert.equal((await api(partner, "/api/library")).items.find(item => item.id === editable.id).text, "修改后的可抽池合成词");
  await a.reload();
  await a.getByRole("button", { name: "打开灵感库" }).click();
  await row.getByText("修改后的可抽池合成词", { exact: true }).waitFor();
  await a.setViewportSize({ width: 320, height: 568 });
  const buttons = await row.locator(".library-item-actions button").evaluateAll(nodes => nodes.map(node => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right })));
  assert.equal(buttons.length, 3);
  assert(buttons.every(button => button.left >= 0 && button.right <= 320), JSON.stringify(buttons));
  assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await row.screenshot({ path: `${output}/qa-pool-actions-320.png` });
  await a.setViewportSize({ width: 390, height: 844 });
  a.once("dialog", dialog => dialog.dismiss());
  await row.getByRole("button", { name: "删除", exact: true }).click();
  assert((await api(owner, "/api/library")).items.some(item => item.id === editable.id));
  await a.route("**/api/library", async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "delete") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "合成删除失败" }) });
    } else await route.continue();
  });
  a.once("dialog", dialog => dialog.accept());
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await a.getByText("合成删除失败", { exact: true }).waitFor();
  assert(await row.isVisible());
  await a.getByRole("button", { name: "关闭提示", exact: true }).click();
  await a.getByText("合成删除失败", { exact: true }).waitFor({ state: "hidden" });
  await a.unroute("**/api/library");
  a.once("dialog", dialog => dialog.accept());
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await row.waitFor({ state: "hidden" });
  assert(!(await api(partner, "/api/library")).items.some(item => item.id === editable.id));
  assert.equal(await a.locator(".library-section-active .library-section-heading span").innerText(), "2");
  pass("可抽池编辑、空值校验、取消和失败草稿保留、刷新持久化；删除确认/拒绝/失败保留与双端同步，320px动作完整可见");
  const reserveFixtures = [
    { sourceId: "fixture-reserve-edit", text: "备用编辑合成词", notes: "备用备注仍需保存在数据中" },
    { sourceId: "fixture-reserve-delete", text: "备用删除合成词", notes: "隐藏的备用来源备注" },
    { sourceId: "fixture-batch-first", text: "批量启用合成甲" },
    { sourceId: "fixture-batch-second", text: "批量启用合成乙" },
    { sourceId: "fixture-batch-keep", text: "保持备用合成丙" },
  ];
  const reserves = (await api(owner, "/api/library", { action: "import", items: reserveFixtures })).items;
  const editReserve = reserves.find(item => item.sourceId === "fixture-reserve-edit");
  const deleteReserve = reserves.find(item => item.sourceId === "fixture-reserve-delete");
  const batchFirst = reserves.find(item => item.sourceId === "fixture-batch-first");
  const batchSecond = reserves.find(item => item.sourceId === "fixture-batch-second");
  const batchKeep = reserves.find(item => item.sourceId === "fixture-batch-keep");
  await a.getByRole("button", { name: "刷新灵感库" }).click();
  const reserveSection = a.locator(".library-section-reserve");
  const reserveRow = reserveSection.locator(`[data-item-id="${editReserve.id}"]`);
  await reserveRow.waitFor();
  assert.equal(await reserveRow.locator(".library-item-meta").count(), 0);
  const universe = library.items.find(item => item.sourceId === "fixture-universe");
  assert.equal(await a.locator(`[data-item-id="${universe.id}"] .library-item-meta`).count(), 0);
  const pendingRow = a.locator(".library-section-pending .library-item-row").filter({ hasText: "待核对合成词" });
  assert((await pendingRow.innerText()).includes("待核对备注需要保留"));
  await reserveRow.getByRole("button", { name: "编辑", exact: true }).click();
  await reserveRow.getByLabel("灵感内容").fill("备用修改后的合成词");
  await reserveSection.getByRole("button", { name: "收起备用栏目", exact: true }).click();
  assert(!(await reserveRow.isVisible()));
  await reserveSection.getByRole("button", { name: "展开备用栏目", exact: true }).click();
  assert.equal(await reserveRow.getByLabel("灵感内容").inputValue(), "备用修改后的合成词");
  await reserveRow.getByRole("button", { name: "保存修改", exact: true }).click();
  await reserveRow.getByText("备用修改后的合成词", { exact: true }).waitFor();
  const reserveEdited = (await api(partner, "/api/library")).items.find(item => item.id === editReserve.id);
  assert.equal(reserveEdited.state, "reserve");
  assert.equal(reserveEdited.sourceId, editReserve.sourceId);
  assert.equal(reserveEdited.notes, editReserve.notes);
  await a.setViewportSize({ width: 320, height: 568 });
  const reserveButtons = await reserveRow.locator(".library-item-actions button").evaluateAll(nodes => nodes.map(node => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right })));
  assert.equal(reserveButtons.length, 3);
  assert(reserveButtons.every(button => button.left >= 0 && button.right <= 320));
  await reserveRow.screenshot({ path: `${output}/qa-reserve-actions-320.png` });
  await a.setViewportSize({ width: 390, height: 844 });
  const deleteReserveRow = reserveSection.locator(`[data-item-id="${deleteReserve.id}"]`);
  a.once("dialog", dialog => dialog.dismiss());
  await deleteReserveRow.getByRole("button", { name: "删除", exact: true }).click();
  assert((await api(owner, "/api/library")).items.some(item => item.id === deleteReserve.id));
  a.once("dialog", dialog => dialog.accept());
  await deleteReserveRow.getByRole("button", { name: "删除", exact: true }).click();
  await deleteReserveRow.waitFor({ state: "hidden" });
  assert(!(await api(partner, "/api/library")).items.some(item => item.id === deleteReserve.id));
  assert((await api(partner, "/api/export")).items.find(item => item.sourceId === editReserve.sourceId).notes === editReserve.notes);
  pass("灵感库标题简化；可抽和备用隐藏来源备注且导出保留，待核对说明仍可见；备用可编辑删除并在320px完整显示");

  await reserveSection.getByRole("button", { name: "批量启用", exact: true }).click();
  const toolbar = a.locator(".reserve-batch-toolbar");
  assert(await toolbar.getByRole("button", { name: "启用所选（0）", exact: true }).isDisabled());
  const firstCheck = reserveSection.locator(`[data-item-id="${batchFirst.id}"]`).getByRole("checkbox");
  const secondCheck = reserveSection.locator(`[data-item-id="${batchSecond.id}"]`).getByRole("checkbox");
  await firstCheck.check(); await secondCheck.check();
  await reserveSection.getByRole("button", { name: "收起备用栏目", exact: true }).click();
  assert(!(await toolbar.isVisible()));
  await reserveSection.getByRole("button", { name: "展开备用栏目", exact: true }).click();
  assert(await firstCheck.isChecked()); assert(await secondCheck.isChecked());
  assert.equal(await toolbar.locator(".batch-selection-count").innerText(), "已选 2 条");
  assert(!(await reserveSection.locator(`[data-item-id="${batchKeep.id}"]`).getByRole("checkbox").isChecked()));
  assert.equal(await a.locator(".library-section-pending input[type=checkbox]").count(), 0);
  await a.route("**/api/library", async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "activate") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "合成批量启用失败" }) });
    } else await route.continue();
  });
  await toolbar.getByRole("button", { name: "启用所选（2）", exact: true }).click();
  await a.getByText("合成批量启用失败", { exact: true }).waitFor();
  assert(await firstCheck.isChecked()); assert(await secondCheck.isChecked());
  await a.unroute("**/api/library");
  await toolbar.getByRole("button", { name: "启用所选（2）", exact: true }).click();
  await toolbar.waitFor({ state: "hidden" });
  const batchResult = (await api(partner, "/api/library")).items;
  assert([batchFirst.id, batchSecond.id].every(id => batchResult.find(item => item.id === id).state === "active"));
  assert.equal(batchResult.find(item => item.id === batchKeep.id).state, "reserve");
  await api(owner, "/api/library", { action: "reserve", ids: [batchFirst.id, batchSecond.id] });
  await a.getByRole("button", { name: "刷新灵感库" }).click();
  await reserveSection.getByRole("button", { name: "批量启用", exact: true }).click();
  await toolbar.getByLabel("全选", { exact: true }).check();
  const beforeAll = (await api(owner, "/api/library")).items.filter(item => item.state === "reserve" && item.readingStatus === "readable" && !item.needsUsageConfirmation && !item.held);
  assert.equal(await reserveSection.locator(".library-batch-item input:checked").count(), beforeAll.length);
  await toolbar.getByRole("button", { name: "取消", exact: true }).click();
  assert((await api(owner, "/api/library")).items.filter(item => beforeAll.some(old => old.id === item.id)).every(item => item.state === "reserve"));
  await reserveSection.getByRole("button", { name: "批量启用", exact: true }).click();
  await toolbar.getByLabel("全选", { exact: true }).check();
  await a.setViewportSize({ width: 320, height: 568 });
  await toolbar.screenshot({ path: `${output}/qa-reserve-batch-320.png` });
  assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await toolbar.getByRole("button", { name: `启用所选（${beforeAll.length}）`, exact: true }).click();
  await toolbar.waitFor({ state: "hidden" });
  const afterAll = (await api(partner, "/api/library")).items;
  assert(beforeAll.every(old => afterAll.find(item => item.id === old.id).state === "active"));
  assert(afterAll.filter(item => ["fixture-review", "fixture-usage"].includes(item.sourceId)).every(item => item.state === "reserve"));
  // Many active rows should no longer force a long scroll to the reserve heading.
  await api(owner, "/api/library", { action: "reserve", ids: [batchKeep.id] });
  await a.getByRole("button", { name: "刷新灵感库" }).click();
  const activeSection = a.locator(".library-section-active");
  await until(async () => (await activeSection.locator(".library-item-row").count()) > 20, "大量可抽条目显示");
  const expandedHeight = (await activeSection.boundingBox()).height;
  const reserveBefore = await reserveSection.evaluate(node => node.getBoundingClientRect().top + scrollY);
  const activeToggle = activeSection.getByRole("button", { name: "收起可抽栏目", exact: true });
  assert.equal(await activeToggle.getAttribute("aria-expanded"), "true");
  const contentId = await activeToggle.getAttribute("aria-controls");
  await activeToggle.focus(); await a.keyboard.press("Enter");
  const collapsedToggle = activeSection.getByRole("button", { name: "展开可抽栏目", exact: true });
  assert.equal(await collapsedToggle.getAttribute("aria-expanded"), "false");
  assert(await a.evaluate(id => document.getElementById(id).hidden, contentId));
  assert((await activeSection.boundingBox()).height < 80);
  assert(expandedHeight > 1000);
  const reserveAfter = await reserveSection.evaluate(node => node.getBoundingClientRect().top + scrollY);
  assert(reserveBefore - reserveAfter > 1000);
  assert.equal(await activeSection.locator(".library-section-heading span").innerText(), String(afterAll.filter(item => item.state === "active").length - 1));
  await a.getByRole("button", { name: "刷新灵感库" }).click();
  await collapsedToggle.waitFor();
  assert.equal(await collapsedToggle.getAttribute("aria-expanded"), "false");
  await reserveSection.getByRole("button", { name: "收起备用栏目", exact: true }).click();
  assert.equal(await reserveSection.getByRole("button", { name: "批量启用", exact: true }).count(), 0);
  const pendingSection = a.locator(".library-section-pending");
  await pendingSection.getByRole("button", { name: "收起待核对栏目", exact: true }).click();
  await a.locator(".library-scroll-area").screenshot({ path: `${output}/qa-library-folded-320.png` });
  assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await pendingSection.getByRole("button", { name: "展开待核对栏目", exact: true }).click();
  await reserveSection.getByRole("button", { name: "展开备用栏目", exact: true }).click();
  await collapsedToggle.click();
  assert(await activeSection.locator(".library-list").isVisible());
  pass("栏目独立收起/展开，保留标题数量，收起大量可抽后备用位置前移，支持键盘和320px；刷新、编辑草稿与批量勾选状态保持");

  await api(owner, "/api/library", { action: "reserve", ids: beforeAll.map(item => item.id) });
  await a.setViewportSize({ width: 390, height: 844 });
  pass("批量启用支持勾选、全选与取消，失败保留选择，只启用所选且不绕过待核对限制，320px无横向溢出");

  await a.getByRole("button", { name: "返回首页", exact: true }).click();
  const draw = a.getByRole("button", { name: "抽一张", exact: true });
  await until(() => draw.isEnabled(), "可抽池同步");
  const homeButton = await draw.boundingBox();
  assert(homeButton.y > 844 * 0.8 && homeButton.y + homeButton.height <= 844 - 20);
  await screenshot(a, "qa-home");
  await draw.click();
  await a.getByText("等对方抽好，一起拆开", { exact: true }).waitFor();
  const roundId = (await api(owner, "/api/state")).round.id;
  assert(!((await api(owner, "/api/state")).round.cards));
  assert(!(await a.locator("body").innerText()).match(/宇宙|爵士/));
  await screenshot(a, "qa-wait");
  const later = await a.getByRole("button", { name: "稍后继续", exact: true }).boundingBox();
  assert(later.y > 844 * 0.85);
  await a.getByRole("button", { name: "返回首页", exact: true }).click();
  await a.getByRole("button", { name: "打开灵感库" }).click();
  const held = (await api(owner, "/api/library")).items.find(item => item.held);
  const heldRow = a.locator(`[data-item-id="${held.id}"]`);
  await heldRow.waitFor();
  assert(await heldRow.getByRole("button", { name: "编辑", exact: true }).isDisabled());
  assert(await heldRow.getByRole("button", { name: "删除", exact: true }).isDisabled());
  await a.getByRole("button", { name: "返回首页", exact: true }).click();
  await a.reload();
  await a.getByRole("button", { name: "查看", exact: true }).click();
  assert.equal((await api(owner, "/api/state")).round.id, roundId);
  pass("首页底部按钮、等待页底部轻量动作，盲抽保密与刷新恢复");
  await b.getByRole("button", { name: "查看", exact: true }).click();
  await b.getByRole("button", { name: "抽一张", exact: true }).click();
  assert(!(await api(owner, "/api/state")).round.cards);
  await a.emulateMedia({ reducedMotion: "no-preference" });
  await b.emulateMedia({ reducedMotion: "no-preference" });
  await a.getByRole("button", { name: "一起拆开", exact: true }).click();
  await a.locator(".result-cards.is-opening").waitFor();
  await b.locator(".result-cards.is-opening").waitFor();
  for (const page of [a, b]) {
    await page.locator(".result-card").first().waitFor();
    await page.locator(".result-cards.is-opening").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".result-card[aria-pressed=false]").count(), 2);
    assert((await page.locator(".result-card").first().innerText()).includes("你抽到"));
  }
  await checkCards(a, "short-390");
  await screenshot(a, "qa-revealed");
  assert(results.layouts.at(-1).cards[0].fontSize >= 50);
  pass("共同揭晓后上下同尺寸错位双卡，短词大字，初始均未选择");
  await a.getByRole("button", { name: "返回首页", exact: true }).click();
  await a.getByRole("heading", { name: "看看今天要做什么", exact: true }).waitFor();
  assert.equal(await a.locator(".active-round-teaser .body-copy").count(), 0);
  await screenshot(a, "qa-home-copy");
  await a.getByRole("button", { name: "查看", exact: true }).click();

  await a.evaluate(() => document.fonts.ready);
  assert(await a.evaluate(() => document.fonts.check('64px "Life Draw Serif"', '宇宙爵士')));
  const cdp = await owner.newCDPSession(a);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const root = await cdp.send("DOM.getDocument");
  const node = await cdp.send("DOM.querySelector", { nodeId: root.root.nodeId, selector: ".result-card-text" });
  const fonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: node.nodeId });
  assert(fonts.fonts.some((font) => font.isCustomFont && font.glyphCount > 0), JSON.stringify(fonts));
  await cdp.detach();
  pass("双方观察到拆信过渡，实际中文字形来自本地加载的宋体字库");

  const oldCards = (await api(owner, "/api/state")).round.cards.map((card) => card.id);
  await api(owner, "/api/library", { action: "bulkAdd", texts: ["露营", "漫步"], activate: true });
  await a.getByRole("button", { name: "重新抽取", exact: true }).click();
  await a.getByRole("button", { name: "保留这两张", exact: true }).click();
  assert.equal((await api(owner, "/api/state")).round.proposal, null);
  await a.getByRole("button", { name: "重新抽取", exact: true }).click();
  await a.getByRole("button", { name: "邀请对方重新抽取", exact: true }).click();
  await b.getByRole("button", { name: "同意重新抽取", exact: true }).waitFor();
  assert.equal((await api(owner, "/api/state")).round.id, roundId);
  await a.reload();
  await a.getByRole("button", { name: "查看", exact: true }).click();
  await a.getByRole("button", { name: "撤回邀请", exact: true }).click();
  await b.getByRole("button", { name: "同意重新抽取", exact: true }).waitFor({ state: "hidden" });
  assert.equal((await api(owner, "/api/state")).round.proposal, null);
  await a.getByRole("button", { name: "重新抽取", exact: true }).click();
  await a.getByRole("button", { name: "邀请对方重新抽取", exact: true }).click();
  await b.getByRole("button", { name: "保留这两张", exact: true }).click();
  await a.getByRole("button", { name: "重新抽取", exact: true }).waitFor();
  assert.equal((await api(owner, "/api/state")).round.id, roundId);
  await a.getByRole("button", { name: "重新抽取", exact: true }).click();
  await a.getByRole("button", { name: "邀请对方重新抽取", exact: true }).click();
  await b.getByRole("button", { name: "同意重新抽取", exact: true }).click();
  await b.locator(".result-cards.is-exiting").waitFor();
  const replacement = await api(owner, "/api/state");
  assert.notEqual(replacement.round.id, roundId);
  assert.equal(replacement.round.status, "ready");
  assert(!replacement.round.cards);
  await a.getByRole("button", { name: "一起拆开", exact: true }).click();
  for (const page of [a, b]) {
    await page.locator(".result-card").first().waitFor();
    await page.locator(".result-cards.is-opening").waitFor({ state: "hidden" });
  }
  const newCards = (await api(owner, "/api/state")).round.cards;
  assert(newCards.every((card) => !oldCards.includes(card.id)));
  await screenshot(a, "qa-redraw");
  pass("重抽确认可取消、刷新保留待回应、发起人撤回、对方拒绝均不换卡；双方同意才收回旧卡并盲抽新的一组");
  // Reproduce a concurrent invitation arriving after a local pick but before submission.
  const competingRound = (await api(owner, "/api/state")).round;
  await a.route("**/api/select", async route => {
    await api(partner, "/api/select", { roundId: competingRound.id, cardId: competingRound.cards[1].id, proposalId: "qa-copy-competing" });
    await route.continue();
  });
  await a.locator(".result-card").first().click();
  const conflictResponse = a.waitForResponse(response => response.url().endsWith("/api/select") && response.request().method() === "POST");
  await a.getByRole("button", { name: "就选这一张", exact: true }).click();
  assert.equal((await conflictResponse).status(), 409);
  await a.getByRole("button", { name: "我也选这一张", exact: true }).waitFor();
  assert.equal(await a.locator(".message-banner").count(), 0);
  assert.equal(await a.locator(".decision-dialog[open] .decision-error").count(), 0);
  assert.equal(await a.locator(".result-card[aria-pressed=true]").count(), 1);
  assert.equal((await api(owner, "/api/state")).round.selectedCardId, null);
  await a.screenshot({ path: `${output}/qa-invitation-copy.png`, fullPage: true });
  await a.unroute("**/api/select");
  await a.getByRole("button", { name: "再一起看看", exact: true }).click();
  await until(async () => !(await api(owner, "/api/state")).round.proposal, "已有邀请被正常回应");
  pass("首页使用新标题和查看按钮且不显示已打开说明；并发邀请保持共识保护，弹窗与背景均无重复待回应提示");


  await a.locator(".result-card").first().click();
  assert.equal((await api(owner, "/api/state")).round.selectedCardId, null);
  await a.getByRole("button", { name: "就选这一张", exact: true }).click();
  await b.getByRole("button", { name: "我也选这一张", exact: true }).waitFor();
  assert.equal((await api(owner, "/api/state")).round.selectedCardId, null);
  await b.getByRole("button", { name: "我也选这一张", exact: true }).click();
  await a.getByRole("button", { name: "完成了", exact: true }).waitFor();
  for (const page of [a, b]) {
    await until(async () => await page.locator(".result-card").count() === 1, "单卡收拢完成");
    assert.equal(await page.locator(".round-panel .result-card").count(), 1);
    assert((await page.locator(".result-card").innerText()).includes("我们选定了"));
  }
  await until(async () => await a.evaluate(() => document.getAnimations().every((animation) => animation.playState !== "running")), "选中卡移到中央");
  assert.equal(await a.locator(".choice-confirmed").count(), 0);
  await screenshot(a, "qa-selected-single");
  const selected = (await api(owner, "/api/state")).round.selectedCardId;
  assert.equal((await api(partner, "/api/state")).round.selectedCardId, selected);
  await a.reload();
  await a.getByRole("button", { name: "查看", exact: true }).click();
  assert.equal(await a.locator(".result-card").count(), 1);
  assert.equal(await a.locator(".opening-envelope-pair").count(), 0);
  await a.getByRole("button", { name: "完成了", exact: true }).click();
  await b.getByText("今天完成了，明天再来。", { exact: true }).waitFor();
  assert.equal(await b.locator(".result-card").count(), 1);
  await a.getByRole("button", { name: "返回首页", exact: true }).click();
  await a.getByRole("button", { name: "打开灵感库" }).click();
  const completedSection = a.locator(".library-section-completed");
  await completedSection.getByRole("button", { name: "收起已完成栏目", exact: true }).click();
  assert(!(await completedSection.locator(".library-list").isVisible()));
  await completedSection.getByRole("button", { name: "展开已完成栏目", exact: true }).click();
  assert(await completedSection.locator(".library-list").isVisible());
  await a.getByRole("button", { name: "返回首页", exact: true }).click();
  pass("本地点选、邀请与共同确认分离；双端收拢为单卡，刷新不重播，完成仍只保留该卡");
  await a.emulateMedia({ reducedMotion: "reduce" });
  await b.emulateMedia({ reducedMotion: "reduce" });

  const titles = ["在下班后的一个小时里一起尝试此前从来没有做过的一项小小新体验", "An unexpectedly long title for a shared everyday adventure"];
  await api(owner, "/api/library", { action: "bulkAdd", texts: titles, activate: true });
  const longId = (await api(owner, "/api/draw", {})).round.id;
  await api(partner, "/api/draw", {});
  await api(owner, "/api/reveal", { roundId: longId });
  await a.reload();
  await a.getByRole("button", { name: "查看", exact: true }).click();
  for (const width of [390, 320]) {
    await a.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await checkCards(a, `long-${width}`);
    await screenshot(a, `qa-long-${width}`);
  }
  // Simulate 200% text size without zooming or changing layout widths.
  await a.evaluate(() => {
    const elements = [...document.querySelectorAll("h1, button, .result-card-header, .result-card-text")];
    const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => { element.style.fontSize = `${sizes[index] * 2}px`; });
  });
  await checkCards(a, "long-320-text-200");
  assert(results.layouts.at(-1).cards.every((card) => card.fontSize >= 46), "文字确实放大到200%");
  await screenshot(a, "qa-text-200");
  await a.locator(".result-card").first().click();
  await checkCards(a, "long-320-text-200-selected");
  pass("390/320px 长中英文、200%文字和减少动态效果，完整显示且无横向溢出");
  await a.locator(".round-options summary").click();
  a.once("dialog", (dialog) => dialog.dismiss());
  await a.getByRole("button", { name: "取消本轮", exact: true }).click();
  assert.equal((await api(owner, "/api/state")).round.status, "revealed");
  a.once("dialog", (dialog) => dialog.accept());
  await a.getByRole("button", { name: "取消本轮", exact: true }).click();
  await until(async () => (await api(partner, "/api/state")).round.status === "cancelled", "取消提交完成");
  assert.equal((await api(partner, "/api/state")).round.status, "cancelled");
  assert.equal((await api(owner, "/api/library")).items.filter((item) => item.held).length, 0);
  pass("顶部更多菜单可取消，拒绝确认保留本轮，确认后双端释放");
  await a.setViewportSize({ width: 390, height: 844 });
  const lowerId = (await api(owner, "/api/draw", {})).round.id;
  await api(partner, "/api/draw", {});
  const lowerState = await api(owner, "/api/reveal", { roundId: lowerId });
  const free = (await api(owner, "/api/library")).items.filter((item) => item.state === "active" && !item.held);
  if (free.length) await api(owner, "/api/library", { action: "reserve", ids: free.map((item) => item.id) });
  for (const page of [a, b]) {
    await page.reload();
    await page.getByRole("button", { name: "查看", exact: true }).click();
    assert.equal(await page.locator(".opening-envelope-pair").count(), 0);
  }
  await a.getByRole("button", { name: "重新抽取", exact: true }).click();
  await a.getByRole("button", { name: "邀请对方重新抽取", exact: true }).click();
  await b.getByRole("button", { name: "同意重新抽取", exact: true }).click();
  await b.getByRole("alert").waitFor();
  assert((await b.getByRole("alert").innerText()).includes("至少两条不同"));
  const unchanged = (await api(owner, "/api/state")).round;
  assert.equal(unchanged.id, lowerId);
  assert.deepEqual(unchanged.cards.map((card) => card.id), lowerState.round.cards.map((card) => card.id));
  await b.getByRole("button", { name: "保留这两张", exact: true }).click();
  await until(async () => !(await api(owner, "/api/state")).round.proposal, "对方拒绝已经提交");
  results.declineSync = { visibility: await a.evaluate(() => document.visibilityState), peerVisibility: await b.evaluate(() => document.visibilityState) };
  await a.bringToFront();
  await a.getByRole("button", { name: "重新抽取", exact: true }).waitFor();
  const lowerCard = a.locator(".result-card").nth(1);
  const lowerText = await lowerCard.locator(".result-card-text").innerText();
  await lowerCard.click();
  await a.getByRole("button", { name: "就选这一张", exact: true }).click();
  await b.getByRole("button", { name: "我也选这一张", exact: true }).click();
  for (const page of [a, b]) {
    await until(async () => await page.locator(".result-card").count() === 1, "下卡成为唯一结果");
    assert.equal(await page.locator(".result-card-text").innerText(), lowerText);
  }
  await screenshot(a, "qa-selected-lower");
  await api(owner, "/api/cancel", { roundId: lowerId });
  pass("其他候选不足时保留原卡并明确提示；下方卡片也能共同选定为唯一结果，减少动态效果无需等待");
  assert.equal(results.pageErrors.length, 0, results.pageErrors.join("\n"));
  console.log(`${results.checks.length} 组本机双浏览器检查通过，无 pageerror。`);
} catch (error) {
  for (const [index, context] of browser.contexts().entries()) {
    const page = context.pages()[0];
    if (!page) continue;
    await page.screenshot({ path: `${output}/browser-failure-${index}.png`, fullPage: true }).catch(() => {});
    const data = await page.evaluate(async () => ({ visibility: document.visibilityState, text: document.body.innerText,
      state: await fetch("/api/state").then(response => response.json()) })).catch(() => null);
    await writeFile(`${output}/browser-failure-${index}.json`, JSON.stringify(data, null, 2));
  }
  throw error;
} finally {
  await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
