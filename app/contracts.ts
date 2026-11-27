export type RoundStatus = "waiting" | "ready" | "revealed" | "selected" | "completed" | "cancelled";

export type ProposalKind = "selection" | "redraw";

export type ProposalAction = "approve" | "decline" | "withdraw";

export interface RoundProposal {
  id: string;
  kind: ProposalKind;
  requestedBy: "self" | "partner";
  cardId: string | null;
}

export interface RevealedCard {
  id: string;
  owner: "self" | "partner";
  text: string;
}

export interface RoundView {
  id: string;
  status: RoundStatus;
  ownDrawn: boolean;
  partnerDrawn: boolean;
  cards?: RevealedCard[];
  selectedCardId: string | null;
  selectedText: string | null;
  proposal: RoundProposal | null;
  version: number;
}

export interface SpaceView {
  id: string;
  name: string;
  paired: boolean;
  ownName: string;
  partnerName: string | null;
  activeCount: number;
  reserveCount: number;
  pendingReviewCount: number;
}

export interface AppState {
  viewer: { id: string; name: string };
  space: SpaceView | null;
  round: RoundView | null;
}

export interface LibraryItem {
  id: string;
  text: string | null;
  tentativeText: string | null;
  state: "active" | "reserve" | "completed";
  readingStatus: "readable" | "needs_confirmation";
  needsUsageConfirmation: boolean;
  sourceId: string | null;
  source: "manual" | "system" | "photo" | "import";
  notes: string;
  held: boolean;
  availableAfter: string | null;
}

export interface LibraryResponse {
  items: LibraryItem[];
}

export interface ImportItem {
  sourceId?: string;
  text: string | null;
  tentativeText?: string | null;
  readingStatus?: "readable" | "needs_confirmation";
  needsUsageConfirmation?: boolean;
  notes?: string;
  source?: "photo" | "import";
}

export type LibraryMutation =
  | { action: "add"; text: string; activate: boolean }
  | { action: "bulkAdd"; texts: string[]; activate: boolean }
  | { action: "activate" | "reserve"; ids: string[] }
  | { action: "edit"; id: string; text: string; confirmReading: boolean }
  | { action: "delete"; id: string }
  | { action: "import"; items: ImportItem[] };
