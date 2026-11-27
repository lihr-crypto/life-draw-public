import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types requires a runtime extension.
import { toImportItems } from "../app/import-library.ts";

test("照片备用库导入保留原文、来源ID与照片来源，暂读不冒充原文", () => {
  const result = toImportItems({ items: [
    {
      id: "photo-fixture-001",
      raw_text: "吉他",
      reading_status: "readable",
      source: { photo: "fixture.jpg", bbox_px: [0, 0, 10, 10] },
    },
    {
      id: "photo-fixture-002",
      raw_text: null,
      tentative_text: "尚不确定的词",
      reading_status: "needs_confirmation",
      needs_usage_confirmation: true,
      source: { photo: "fixture.jpg" },
    },
  ] });
  assert.equal(result[0].sourceId, "photo-fixture-001");
  assert.equal(result[0].text, "吉他");
  assert.equal(result[0].source, "photo");
  assert.equal(result[1].text, null);
  assert.equal(result[1].tentativeText, "尚不确定的词");
  assert.equal(result[1].readingStatus, "needs_confirmation");
  assert.equal(result[1].needsUsageConfirmation, true);
  assert.equal(result[1].source, "photo");
});

test("无原文的备用记录默认待核对；兼容导出字段并保留同词不同来源", () => {
  const result = toImportItems({ items: [
    { sourceId: "first", text: "相同原词", source: "photo" },
    { sourceId: "second", text: "相同原词", source: "import" },
    { sourceId: "pending", text: null, tentativeText: "暂读" },
  ] });
  assert.equal(result.length, 3);
  assert.equal(result[0].sourceId, "first");
  assert.equal(result[1].sourceId, "second");
  assert.equal(result[2].readingStatus, "needs_confirmation");
  assert.equal(result[2].text, null);
});
