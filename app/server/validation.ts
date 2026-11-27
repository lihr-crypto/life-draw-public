import type { ImportItem, LibraryMutation, ProposalAction } from "../contracts";
import {
  MAX_IMPORT_ITEMS,
  MAX_LIBRARY_ITEMS,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_SPACE_NAME_LENGTH,
  MAX_SOURCE_ID_LENGTH,
  MAX_TEXT_LENGTH,
} from "./core";
import { ServiceError } from "./errors";
import { asRecord, optionalString, requiredString } from "./http";

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ServiceError(400, "invalid_request", `${field} 必须是布尔值。`);
  }
  return value;
}

function stringArray(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new ServiceError(400, "invalid_request", `${field} 数量无效。`);
  }
  return value.map((item) => requiredString(item, field, MAX_TEXT_LENGTH));
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ServiceError(400, "invalid_request", `${field} 必须是文本。`);
  }
  const text = value.trim();
  if (text.length > MAX_TEXT_LENGTH) {
    throw new ServiceError(400, "invalid_request", `${field} 过长。`);
  }
  return text || null;
}

function importItem(value: unknown): ImportItem {
  const record = asRecord(value);
  const sourceId = optionalString(record.sourceId, "sourceId", MAX_SOURCE_ID_LENGTH);
  const text = nullableText(record.text, "text");
  const tentativeText = nullableText(record.tentativeText, "tentativeText");
  const readingStatus = record.readingStatus;
  if (
    readingStatus !== undefined &&
    readingStatus !== "readable" &&
    readingStatus !== "needs_confirmation"
  ) {
    throw new ServiceError(400, "invalid_request", "readingStatus 无效。");
  }
  const source = record.source;
  if (source !== undefined && source !== "photo" && source !== "import") {
    throw new ServiceError(400, "invalid_request", "source 无效。");
  }
  if (
    record.needsUsageConfirmation !== undefined &&
    typeof record.needsUsageConfirmation !== "boolean"
  ) {
    throw new ServiceError(400, "invalid_request", "needsUsageConfirmation 无效。");
  }
  const notes = optionalString(record.notes, "notes", MAX_NOTES_LENGTH);
  return {
    ...(sourceId ? { sourceId } : {}),
    text,
    ...(tentativeText ? { tentativeText } : {}),
    ...(readingStatus ? { readingStatus } : {}),
    ...(record.needsUsageConfirmation !== undefined
      ? { needsUsageConfirmation: record.needsUsageConfirmation as boolean }
      : {}),
    ...(notes ? { notes } : {}),
    ...(source ? { source } : {}),
  };
}

export function parseLibraryMutation(value: unknown): LibraryMutation {
  const record = asRecord(value);
  const action = record.action;
  switch (action) {
    case "add":
      return {
        action,
        text: requiredString(record.text, "text", MAX_TEXT_LENGTH),
        activate: booleanField(record.activate, "activate"),
      };
    case "bulkAdd":
      return {
        action,
        texts: stringArray(record.texts, "texts", MAX_LIBRARY_ITEMS),
        activate: booleanField(record.activate, "activate"),
      };
    case "activate":
    case "reserve":
      return {
        action,
        ids: stringArray(record.ids, "ids", MAX_LIBRARY_ITEMS).map((id) =>
          requiredString(id, "id", 100),
        ),
      };
    case "delete":
      return { action, id: requiredString(record.id, "id", 100) };
    case "edit":
      return {
        action,
        id: requiredString(record.id, "id", 100),
        text: requiredString(record.text, "text", MAX_TEXT_LENGTH),
        confirmReading: booleanField(record.confirmReading, "confirmReading"),
      };
    case "import": {
      if (!Array.isArray(record.items) || record.items.length === 0 || record.items.length > MAX_IMPORT_ITEMS) {
        throw new ServiceError(400, "invalid_request", "items 数量无效。");
      }
      return { action, items: record.items.map(importItem) };
    }
    default:
      throw new ServiceError(400, "invalid_request", "library action 无效。");
  }
}

export function parseSpaceName(value: unknown): string | undefined {
  return optionalString(value, "name", MAX_SPACE_NAME_LENGTH);
}

export function parseMemberName(value: unknown): string | undefined {
  return optionalString(value, "name", MAX_NAME_LENGTH);
}

export function parseInviteToken(value: unknown): string {
  return requiredString(value, "token", 500);
}

export function parseRoundId(value: unknown): string {
  return requiredString(value, "roundId", 100);
}

export function parseCardId(value: unknown): string {
  return requiredString(value, "cardId", 100);
}

export function parseProposalId(value: unknown): string {
  return requiredString(value, "proposalId", 100);
}

export function parseProposalAction(value: unknown): ProposalAction {
  if (value !== "approve" && value !== "decline" && value !== "withdraw") {
    throw new ServiceError(400, "invalid_request", "proposal action 无效。");
  }
  return value;
}
