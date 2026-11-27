import type { ImportItem } from "./contracts";

export function toImportItems(value: unknown): ImportItem[] {
  const root = asRecord(value);
  const sourceItems = Array.isArray(value)
    ? value
    : root && Array.isArray(root.items)
      ? root.items
      : [];

  return sourceItems.flatMap((entry) => {
    const item = asRecord(entry);
    if (!item) return [];
    const text = asNullableString(item.text) ?? asNullableString(item.raw_text);
    const tentativeText =
      asNullableString(item.tentativeText) ?? asNullableString(item.tentative_text);
    const source = asRecord(item.source);
    const sourceId =
      asNullableString(item.sourceId) ??
      asNullableString(source?.id) ??
      asNullableString(item.id);
    const readingStatus =
      !text || item.readingStatus === "needs_confirmation" || item.reading_status === "needs_confirmation"
        ? "needs_confirmation"
        : "readable";
    const needsUsageConfirmation = Boolean(
      item.needsUsageConfirmation ?? item.needs_usage_confirmation,
    );
    if (!text && !tentativeText) return [];
    return [
      {
        sourceId: sourceId || undefined,
        text: text || null,
        tentativeText: tentativeText || null,
        readingStatus,
        needsUsageConfirmation,
        notes: asNullableString(item.notes) || undefined,
        source: source?.type === "photo" || typeof source?.photo === "string" || item.source === "photo" ? "photo" : "import",
      } satisfies ImportItem,
    ];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
