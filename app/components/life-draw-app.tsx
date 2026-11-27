"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  Download,
  FileJson,
  Lightbulb,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import type {
  AppState,
  LibraryItem,
  LibraryMutation,
  LibraryResponse,
  RevealedCard,
  RoundView,
  ProposalAction,
} from "../contracts";
import { Envelope } from "./envelope";
import { RoundCardStage } from "./round-motion";
import { toImportItems } from "../import-library";

type Screen = "home" | "round" | "library";

type ApiErrorPayload = {
  error?: string;
  code?: string;
};

class ApiRequestError extends Error {
  status: number;
  code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(input, {
    ...init,
    headers,
    cache: "no-store",
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const details = (payload ?? {}) as ApiErrorPayload;
    throw new ApiRequestError(
      details.error || `请求失败（${response.status}）`,
      response.status,
      details.code,
    );
  }

  return payload as T;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function isApiError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

function errorMessage(error: unknown, fallback = "暂时无法完成，请稍后再试。") {
  if (isApiError(error)) {
    if (error.code === "not_paired" || error.code === "space_not_paired") {
      return "请先邀请对方加入这个空间。";
    }
    if (error.code === "insufficient_items" || error.code === "not_enough_items") {
      return "灵感库里还需要至少两条可抽内容。";
    }
    if (error.code === "round_not_ready") return "等双方都抽好后才能一起拆开。";
    if (error.code === "not_enough_redraw_items") {
      return "还需要至少两条不同的可抽灵感，先保留这两张。可以到灵感库添加。";
    }
    if (error.code === "proposal_resolved") return "这次邀请已经处理，页面已更新为最新状态。";
    if (error.code === "selection_conflict") {
      return "对方已经选定另一张，页面会按共同结果更新。";
    }
    if (error.code === "held_item" || error.code === "item_held") {
      return "这条内容正在本轮使用，暂时不能编辑。";
    }
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function isPendingReview(item: LibraryItem) {
  return item.readingStatus === "needs_confirmation" || item.needsUsageConfirmation;
}

function normaliseName(value: string) {
  const name = value.trim();
  return name.length > 0 ? name : undefined;
}

export function LifeDrawApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [loading, setLoading] = useState(true);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("invite"),
  );
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [joinName, setJoinName] = useState("");
  const [createName, setCreateName] = useState("");
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const stateReadEpoch = useRef(0);
  const libraryReadEpoch = useRef(0);
  const proposalAttempt = useRef<{ signature: string; id: string } | null>(null);
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [roundWasOpened, setRoundWasOpened] = useState(false);
  const refreshInFlight = useRef(false);

  const refreshState = useCallback(async (silent = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const readEpoch = stateReadEpoch.current;
    if (!silent) setLoading(true);

    try {
      const nextState = await requestJson<AppState>("/api/state");
      if (readEpoch !== stateReadEpoch.current) return;
      setState(nextState);
      if (nextState.space?.paired) {
        setNotice(null);
        setShareLink(null);
      }
      setAuthRequired(false);
      if (!silent || !nextState.round?.proposal) setError(null);
      setPendingCardId((current) => {
        if (!nextState.round?.cards?.some((card) => card.id === current)) return null;
        if (nextState.round.selectedCardId) return null;
        return current;
      });
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 401) {
        setAuthRequired(true);
      } else {
        setError(errorMessage(requestError, "无法读取今天的状态。"));
      }
    } finally {
      refreshInFlight.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  const refreshLibrary = useCallback(async (silent = false) => {
    const readEpoch = libraryReadEpoch.current;
    if (!silent) setLibraryLoading(true);
    try {
      const nextLibrary = await requestJson<LibraryResponse>("/api/library");
      if (readEpoch !== libraryReadEpoch.current) return;
      setLibrary(nextLibrary);
      setError(null);
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 401) {
        setAuthRequired(true);
      } else {
        setError(errorMessage(requestError, "无法打开灵感库。"));
      }
    } finally {
      if (!silent) setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshState();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshState]);

  useEffect(() => {
    if (loading || authRequired) return;

    const poll = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void refreshState(true);
      if (screen === "library") void refreshLibrary(true);
    };
    const timer = window.setInterval(poll, 2200);
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible" && navigator.onLine) poll();
    };
    window.addEventListener("focus", refreshOnReturn);
    window.addEventListener("online", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnReturn);
      window.removeEventListener("online", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [authRequired, loading, refreshLibrary, refreshState, screen]);

  const applyStateMutation = useCallback(
    (nextState: AppState) => {
      stateReadEpoch.current += 1;
      setState(nextState);
      setError(null);
      setNotice(null);
    },
    [],
  );

  const createSpace = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (creating) return;
      setCreating(true);
      setError(null);
      try {
        const nextState = await postJson<AppState>("/api/space", {
          name: normaliseName(createName),
        });
        applyStateMutation(nextState);
      } catch (requestError) {
        if (isApiError(requestError) && requestError.status === 401) {
          setAuthRequired(true);
        } else {
          setError(errorMessage(requestError, "空间创建失败。"));
        }
      } finally {
        setCreating(false);
      }
    },
    [applyStateMutation, createName, creating],
  );

  const joinSpace = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!inviteToken || joining) return;
      setJoining(true);
      setError(null);
      try {
        const nextState = await postJson<AppState>("/api/join", {
          token: inviteToken,
          name: normaliseName(joinName),
        });
        applyStateMutation(nextState);
        setInviteToken(null);
        window.history.replaceState({}, "", window.location.pathname);
      } catch (requestError) {
        if (isApiError(requestError) && requestError.status === 401) {
          setAuthRequired(true);
        } else {
          setError(errorMessage(requestError, "加入空间失败，请检查邀请链接是否仍有效。"));
        }
      } finally {
        setJoining(false);
      }
    },
    [applyStateMutation, inviteToken, joinName, joining],
  );

  const createInvite = useCallback(async () => {
    setError(null);
    try {
      const result = await postJson<{ token: string; expiresAt: string }>(
        "/api/invite",
        {},
      );
      const link = `${window.location.origin}/?invite=${encodeURIComponent(result.token)}`;
      setShareLink(link);
      try {
        if (!navigator.clipboard) throw new Error("clipboard_unavailable");
        await navigator.clipboard.writeText(link);
        setNotice("邀请链接已复制，可以发给对方。有效期 24 小时。 ");
      } catch {
        setNotice("邀请链接已生成，请手动复制上方链接后发给对方。有效期 24 小时。 ");
      }
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 401) {
        setAuthRequired(true);
      } else {
        setError(errorMessage(requestError, "暂时无法生成邀请链接。"));
      }
    }
  }, []);

  const draw = useCallback(async () => {
    if (drawing) return;
    setDrawing(true);
    setError(null);
    try {
      const nextState = await postJson<AppState>("/api/draw", {});
      applyStateMutation(nextState);
      setScreen("round");
      setRoundWasOpened(true);
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 401) {
        setAuthRequired(true);
      } else {
        setError(errorMessage(requestError, "暂时无法抽签。"));
      }
      await refreshState(true);
    } finally {
      setDrawing(false);
    }
  }, [applyStateMutation, drawing, refreshState]);

  const reveal = useCallback(async () => {
    const roundId = state?.round?.id;
    if (!roundId || revealing) return;
    setRevealing(true);
    setError(null);
    try {
      const nextState = await postJson<AppState>("/api/reveal", { roundId });
      applyStateMutation(nextState);
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 401) {
        setAuthRequired(true);
      } else {
        setError(errorMessage(requestError, "还不能揭晓，请稍后再试。"));
      }
      await refreshState(true);
    } finally {
      setRevealing(false);
    }
  }, [applyStateMutation, refreshState, revealing, state?.round?.id]);

  const runDecision = useCallback(async (path: string, payload: unknown) => {
    if (deciding) return false;
    setDeciding(true);
    stateReadEpoch.current += 1;
    setError(null);
    try {
      const nextState = await postJson<AppState>(path, payload);
      applyStateMutation(nextState);
      setPendingCardId(null);
      proposalAttempt.current = null;
      return true;
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 401) {
        setAuthRequired(true);
      } else {
        await refreshState(true);
        // The invitation supplies the next action; keep only other failures visible.
        if (isApiError(requestError) && requestError.code === "proposal_pending") {
          setPendingCardId(null);
        } else {
          setError(errorMessage(requestError, "暂时无法提交，请稍后重试。"));
        }
      }
      return false;
    } finally {
      setDeciding(false);
    }
  }, [applyStateMutation, deciding, refreshState]);

  const propose = useCallback(async (kind: "selection" | "redraw") => {
    const roundId = state?.round?.id;
    if (!roundId || (kind === "selection" && !pendingCardId)) return false;
    const signature = `${roundId}/${kind}/${kind === "selection" ? pendingCardId : ""}`;
    if (proposalAttempt.current?.signature !== signature) {
      proposalAttempt.current = { signature, id: crypto.randomUUID() };
    }
    setSelecting(kind === "selection");
    try {
      return await runDecision(kind === "selection" ? "/api/select" : "/api/redraw", {
        roundId,
        proposalId: proposalAttempt.current.id,
        ...(kind === "selection" ? { cardId: pendingCardId } : {}),
      });
    } finally {
      setSelecting(false);
    }
  }, [pendingCardId, runDecision, state?.round?.id]);

  const respond = useCallback(async (action: ProposalAction) => {
    const round = state?.round;
    if (!round?.proposal) return false;
    return runDecision("/api/respond", {
      roundId: round.id, proposalId: round.proposal.id, action,
    });
  }, [runDecision, state?.round]);

  const complete = useCallback(async () => {
    const roundId = state?.round?.id;
    if (!roundId || completing) return;
    setCompleting(true);
    setError(null);
    try {
      const nextState = await postJson<AppState>("/api/complete", { roundId });
      applyStateMutation(nextState);
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 401) {
        setAuthRequired(true);
      } else {
        setError(errorMessage(requestError, "还不能标记完成，请稍后再试。"));
      }
      await refreshState(true);
    } finally {
      setCompleting(false);
    }
  }, [applyStateMutation, completing, refreshState, state?.round?.id]);

  const cancelRound = useCallback(async () => {
    const roundId = state?.round?.id;
    if (!roundId || cancelling) return;
    const confirmed = window.confirm(
      "取消这一轮后，两张内容会回到可抽池。确定要取消吗？",
    );
    if (!confirmed) return;

    setCancelling(true);
    setError(null);
    try {
      const nextState = await postJson<AppState>("/api/cancel", { roundId });
      applyStateMutation(nextState);
      setPendingCardId(null);
      setScreen("home");
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 401) {
        setAuthRequired(true);
      } else {
        setError(errorMessage(requestError, "暂时无法取消本轮。"));
      }
      await refreshState(true);
    } finally {
      setCancelling(false);
    }
  }, [applyStateMutation, cancelling, refreshState, state?.round?.id]);

  const openLibrary = useCallback(() => {
    if (!state?.space) {
      setError("先创建空间，随后就可以在灵感库里添加内容。 ");
      return;
    }
    setScreen("library");
    setError(null);
    void refreshLibrary();
  }, [refreshLibrary, state?.space]);

  const closeLibrary = useCallback(() => {
    setScreen("home");
    setError(null);
  }, []);

  const mutateLibrary = useCallback(
    async (mutation: LibraryMutation) => {
      libraryReadEpoch.current += 1;
      try {
        const nextLibrary = await postJson<LibraryResponse>("/api/library", mutation);
        libraryReadEpoch.current += 1;
        setLibrary(nextLibrary);
        setError(null);
        return nextLibrary;
      } catch (requestError) {
        if (isApiError(requestError) && requestError.status === 401) {
          setAuthRequired(true);
        }
        throw requestError;
      }
    },
    [],
  );

  const currentRound = state?.round?.status === "cancelled" ? null : state?.round ?? null;
  const shouldShowInviteJoin = Boolean(inviteToken && !state?.space);

  if (authRequired) {
    return <AuthRequired />;
  }

  if (loading && !state) {
    return <LoadingScreen />;
  }

  if (screen === "library") {
    return (
      <LibraryPanel
        error={error}
        library={library}
        loading={libraryLoading}
        notice={state?.space?.paired ? null : notice}
        onBack={closeLibrary}
        onClearMessage={() => {
          setError(null);
          setNotice(null);
        }}
        onMutation={mutateLibrary}
        onRefresh={() => refreshLibrary()}
      />
    );
  }

  return (
    <main className="life-draw-shell">
      <div className="life-draw-app">
        {screen === "round" && currentRound ? (
          <RoundScreen
            busy={{
              cancelling,
              completing,
              drawing,
              revealing,
              selecting,
              deciding,
            }}
            error={error}
            notice={state?.space?.paired ? null : notice}
            onBack={() => setScreen("home")}
            onCancel={cancelRound}
            onComplete={complete}
            onDraw={draw}
            onReveal={reveal}
            onSelectCard={setPendingCardId}
            onSelectConfirm={() => { void propose("selection"); }}
            onProposeRedraw={() => propose("redraw")}
            onRespond={respond}
            pendingCardId={pendingCardId}
            round={currentRound}
          />
        ) : shouldShowInviteJoin ? (
          <JoinScreen
            error={error}
            joining={joining}
            name={joinName}
            onChangeName={setJoinName}
            onJoin={joinSpace}
          />
        ) : (
          <HomeScreen
            creating={creating}
            createName={createName}
            error={error}
            notice={state?.space?.paired ? null : notice}
            onChangeCreateName={setCreateName}
            onCreateInvite={createInvite}
            onCreateSpace={createSpace}
            onDraw={draw}
            onOpenLibrary={openLibrary}
            onContinueRound={() => {
              setScreen("round");
              setRoundWasOpened(true);
            }}
            onClearMessage={() => {
              setError(null);
              setNotice(null);
            }}
            round={currentRound}
            shareLink={state?.space?.paired ? null : shareLink}
            space={state?.space ?? null}
            roundWasOpened={roundWasOpened}
          />
        )}
      </div>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="life-draw-shell">
      <div className="life-draw-app life-draw-loading" aria-busy="true">
        <Envelope className="loading-envelope" />
        <p>正在打开今天的空间…</p>
      </div>
    </main>
  );
}

function AuthRequired() {
  return (
    <main className="life-draw-shell">
      <div className="life-draw-app auth-state">
        <div className="auth-mark" aria-hidden="true">
          <LockKeyhole size={23} strokeWidth={1.5} />
        </div>
        <h1>先登录，再开始今天的抽签</h1>
        <p>登录后，空间和抽签状态会在双方设备间保持同步。</p>
        <a className="primary-button" href="/signin-with-chatgpt?return_to=/">
          使用ChatGPT登录
        </a>
      </div>
    </main>
  );
}

type MessageBannerProps = {
  error: string | null;
  notice: string | null;
  onClear?: () => void;
};

function MessageBanner({ error, notice, onClear }: MessageBannerProps) {
  if (!error && !notice) return null;
  return (
    <div className={`message-banner ${error ? "is-error" : "is-notice"}`} role="status">
      <span>{error || notice}</span>
      {onClear ? (
        <button className="message-dismiss" type="button" onClick={onClear} aria-label="关闭提示">
          <X size={15} strokeWidth={1.6} />
        </button>
      ) : null}
    </div>
  );
}

type HomeScreenProps = {
  creating: boolean;
  createName: string;
  error: string | null;
  notice: string | null;
  onChangeCreateName: (value: string) => void;
  onCreateInvite: () => void;
  onCreateSpace: (event: FormEvent<HTMLFormElement>) => void;
  onDraw: () => void;
  onOpenLibrary: () => void;
  onContinueRound: () => void;
  onClearMessage: () => void;
  round: RoundView | null;
  roundWasOpened: boolean;
  shareLink: string | null;
  space: AppState["space"];
};

function HomeScreen({
  creating,
  createName,
  error,
  notice,
  onChangeCreateName,
  onCreateInvite,
  onCreateSpace,
  onDraw,
  onOpenLibrary,
  onContinueRound,
  onClearMessage,
  round,
  shareLink,
  space,
}: HomeScreenProps) {
  const [createMode, setCreateMode] = useState(false);

  return (
    <>
      <header className="home-header">
        <h1>每日新鲜事</h1>
        <button
          className="icon-button lightbulb-button"
          type="button"
          onClick={onOpenLibrary}
          aria-label="打开灵感库"
          title="灵感库"
        >
          <Lightbulb size={29} strokeWidth={1.45} />
        </button>
      </header>

      <MessageBanner error={error} notice={notice} onClear={onClearMessage} />

      {!space ? (
        <section className="home-content onboarding-content">
          <div className="hero-envelope-wrap">
            <Envelope className="hero-envelope" />
          </div>
          <p className="eyebrow">两个人的每日小事</p>
          <h2>各抽一张，一起选一个</h2>
          <p className="body-copy">
            创建一个小空间，邀请对方加入。每天从灵感库里抽两张，等双方都准备好再一起打开。
          </p>
          {!createMode ? (
            <div className="stacked-actions">
              <button className="primary-button" type="button" onClick={() => setCreateMode(true)}>
                创建空间
              </button>
              <p className="quiet-note">已有邀请链接？打开链接即可加入。</p>
            </div>
          ) : (
            <form className="inline-form create-space-form" onSubmit={onCreateSpace}>
              <label className="field-label" htmlFor="space-name">
                给这个空间起个名字（可选）
              </label>
              <input
                id="space-name"
                value={createName}
                onChange={(event) => onChangeCreateName(event.target.value)}
                placeholder="例如：我们的晚饭"
                maxLength={48}
                autoFocus
              />
              <button className="primary-button" type="submit" disabled={creating}>
                {creating ? "正在创建…" : "创建空间"}
              </button>
              <button className="text-button" type="button" onClick={() => setCreateMode(false)}>
                先不创建
              </button>
            </form>
          )}
        </section>
      ) : !space.paired ? (
        <PairingState
          onCreateInvite={onCreateInvite}
          shareLink={shareLink}
          space={space}
        />
      ) : round ? (
        <section className="home-content active-round-teaser">
          <div className="teaser-envelope-wrap">
            <Envelope className="teaser-envelope" />
          </div>
          <p className="eyebrow">今天的抽签还在这里</p>
          <h2>{round.status === "completed" ? "今天已经选好了" : "看看今天要做什么"}</h2>
          {round.status === "completed" || round.status === "waiting" || round.status === "ready" ? (
            <p className="body-copy">
              {round.status === "completed" ? "明天再来打开下一封信。" : "双方各抽一张，等对方准备好后一起拆开。"}
            </p>
          ) : null}
          <button className="primary-button" type="button" onClick={onContinueRound}>
            查看
          </button>
        </section>
      ) : (
        <section className="home-content paired-empty-state">
          <div className="hero-envelope-wrap">
            <Envelope className="hero-envelope" />
          </div>
          <h2>各抽一张，一起选一个</h2>
          {space.activeCount < 2 ? (
            <p className="body-copy">灵感库里还需要至少两条可抽内容，可以先打开灯泡整理。</p>
          ) : null}
          <button
            className="primary-button"
            type="button"
            onClick={onDraw}
            disabled={space.activeCount < 2}
          >
            抽一张
          </button>
        </section>
      )}
    </>
  );
}

type PairingStateProps = {
  onCreateInvite: () => void;
  shareLink: string | null;
  space: NonNullable<AppState["space"]>;
};

function PairingState({ onCreateInvite, shareLink, space }: PairingStateProps) {
  const [copied, setCopied] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const copyLink = async () => {
    if (!shareLink) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setCopyMessage("已复制，可以发给对方。");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setCopyMessage("复制失败，请手动复制上方链接。");
    }
  };

  return (
    <section className="home-content pairing-content">
      <div className="small-envelope-wrap">
        <Envelope className="small-envelope" />
      </div>
      <p className="eyebrow">空间已创建</p>
      <h2>邀请对方加入</h2>
      <p className="body-copy">
        这是一个一次性链接，复制后由你自己发给对方。对方加入后才能开始今天的抽签。
      </p>
      {!shareLink ? (
        <button className="primary-button" type="button" onClick={onCreateInvite}>
          生成邀请链接
        </button>
      ) : (
        <div className="share-link-box">
          <div className="share-link-value">{shareLink}</div>
          <button className="secondary-button" type="button" onClick={copyLink}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "已复制" : "复制链接"}
          </button>
          <p className="quiet-note">{copyMessage || "链接有效期 24 小时，用过一次就会失效。"}</p>
        </div>
      )}
      <p className="space-meta">
        <span>{space.name || "未命名空间"}</span>
        <span>·</span>
        <span>等待对方加入</span>
      </p>
    </section>
  );
}

type JoinScreenProps = {
  error: string | null;
  joining: boolean;
  name: string;
  onChangeName: (value: string) => void;
  onJoin: (event: FormEvent<HTMLFormElement>) => void;
};

function JoinScreen({ error, joining, name, onChangeName, onJoin }: JoinScreenProps) {
  return (
    <section className="full-panel join-panel">
      <div className="panel-topbar">
        <div className="brand-spacer" />
        <span className="panel-kicker">每日新鲜事</span>
        <div className="brand-spacer" />
      </div>
      <MessageBanner error={error} notice={null} />
      <div className="join-content">
        <div className="small-envelope-wrap">
          <Envelope className="small-envelope" />
        </div>
        <p className="eyebrow">一封邀请</p>
        <h1>加入今天的空间</h1>
        <p className="body-copy">输入一个称呼，对方会在每天的抽签里看到它。</p>
        <form className="inline-form join-form" onSubmit={onJoin}>
          <label className="field-label" htmlFor="join-name">
            你的称呼（可选）
          </label>
          <input
            id="join-name"
            value={name}
            onChange={(event) => onChangeName(event.target.value)}
            placeholder="例如：小林"
            maxLength={32}
            autoFocus
          />
          <button className="primary-button" type="submit" disabled={joining}>
            {joining ? "正在加入…" : "加入空间"}
          </button>
        </form>
      </div>
    </section>
  );
}

type RoundBusyState = {
  cancelling: boolean;
  completing: boolean;
  drawing: boolean;
  revealing: boolean;
  selecting: boolean;
  deciding: boolean;
};

type RoundScreenProps = {
  busy: RoundBusyState;
  error: string | null;
  notice: string | null;
  onBack: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onDraw: () => void;
  onReveal: () => void;
  onSelectCard: (cardId: string | null) => void;
  onSelectConfirm: () => void;
  onProposeRedraw: () => Promise<boolean>;
  onRespond: (action: ProposalAction) => Promise<boolean>;
  pendingCardId: string | null;
  round: RoundView;
};

function DecisionDialog({ open, title, children, onCancel }: {
  open: boolean; title: string; children: React.ReactNode; onCancel?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="decision-dialog" aria-labelledby={heading}
      onCancel={(event) => { event.preventDefault(); onCancel?.(); }}>
      <h2 id={heading}>{title}</h2>
      {children}
    </dialog>
  );
}

function RoundScreen({ busy, error, notice, onBack, onCancel, onComplete, onDraw,
  onReveal, onSelectCard, onSelectConfirm, onProposeRedraw, onRespond, pendingCardId, round,
}: RoundScreenProps) {
  const [redrawConfirm, setRedrawConfirm] = useState(false);
  const [outgoingRound, setOutgoingRound] = useState<RoundView | null>(null);
  const previous = useRef(round);
  const [visualHistory, setVisualHistory] = useState<{ round: RoundView; revealId: string | null }>({ round, revealId: null });
  const visibleRound = outgoingRound ?? round;
  if (visibleRound !== visualHistory.round) {
    const startsReveal = !outgoingRound && Boolean(visibleRound.cards?.length) && !visibleRound.selectedCardId &&
      (!visualHistory.round.cards?.length || visualHistory.round.id !== visibleRound.id);
    setVisualHistory({ round: visibleRound, revealId: startsReveal ? visibleRound.id : visualHistory.revealId });
  }
  const revealOnMount = visualHistory.revealId === visibleRound.id;
  const exiting = Boolean(outgoingRound);
  const hasCards = Boolean(visibleRound.cards?.length);
  const proposal = round.proposal;
  const proposalText = round.cards?.find((card) => card.id === proposal?.cardId)?.text;

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = round;
    if (old.id === round.id || !old.cards?.length || round.status !== "ready" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setOutgoingRound(old);
    const timer = setTimeout(() => setOutgoingRound(null), 560);
    return () => clearTimeout(timer);
    // Only a replacement round should replay the return-to-envelope transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);
  useLayoutEffect(() => { previous.current = round; });
  if (proposal && redrawConfirm) setRedrawConfirm(false);

  return (
    <section className="full-panel round-panel">
      <div className="panel-topbar">
        <button className="icon-button back-button" type="button" onClick={onBack} aria-label="返回首页">
          <ArrowLeft size={25} strokeWidth={1.55} />
        </button>
        <h1>{exiting ? "一起换一组" : visibleRound.selectedCardId ? "今天就做这件事" : hasCards ? "一起选一张" : "今日抽签"}</h1>
        {round.status !== "completed" ? (
          <details className="round-options">
            <summary aria-label="更多本轮操作"><MoreHorizontal size={23} strokeWidth={1.5} /></summary>
            <CancelRoundLink busy={busy.cancelling || busy.deciding || exiting} onCancel={onCancel} />
          </details>
        ) : <div className="topbar-placeholder" aria-hidden="true" />}
      </div>
      <MessageBanner error={error} notice={notice} />
      {!hasCards ? (
        <WaitingRound busy={busy} hasBothDrawn={visibleRound.ownDrawn && visibleRound.partnerDrawn}
          onDraw={onDraw} onReveal={onReveal} onBack={onBack} round={visibleRound} />
      ) : (
        <RevealedRound key={visibleRound.id} busy={busy} onComplete={onComplete}
          onSelectCard={onSelectCard} onSelectConfirm={onSelectConfirm}
          onRedraw={() => setRedrawConfirm(true)} onWithdraw={() => { void onRespond("withdraw"); }}
          pendingCardId={pendingCardId} round={visibleRound} revealOnMount={revealOnMount} exiting={exiting} />
      )}
      <DecisionDialog open={redrawConfirm && !proposal} title="再给今天一次惊喜？"
        onCancel={() => { if (!busy.deciding) setRedrawConfirm(false); }}>
        <p>这两张先放回，重新抽取一组。<br />等对方也同意后，再一起拆开。</p>
        {error ? <p className="decision-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="button" disabled={busy.deciding}
          onClick={async () => { if (await onProposeRedraw()) setRedrawConfirm(false); }}>
          {busy.deciding ? "正在邀请…" : "邀请对方重新抽取"}
        </button>
        <button className="dialog-quiet" type="button" disabled={busy.deciding} onClick={() => setRedrawConfirm(false)}>保留这两张</button>
      </DecisionDialog>
      <DecisionDialog open={Boolean(proposal?.requestedBy === "partner") && !exiting}
        title={proposal?.kind === "redraw" ? "再给今天一次惊喜？" : "一起选这张，好吗？"}>
        <p>{proposal?.kind === "redraw"
          ? "对方邀请你重新抽取一组。你同意后，这两张会一起换成新的信。"
          : <>对方想选「{proposalText}」。<br />你也愿意一起做这件事吗？</>}</p>
        {error ? <p className="decision-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="button" disabled={busy.deciding}
          onClick={() => { void onRespond("approve"); }}>
          {busy.deciding ? "正在确认…" : proposal?.kind === "redraw" ? "同意重新抽取" : "我也选这一张"}
        </button>
        <button className="dialog-quiet" type="button" disabled={busy.deciding}
          onClick={() => { void onRespond("decline"); }}>
          {proposal?.kind === "redraw" ? "保留这两张" : "再一起看看"}
        </button>
      </DecisionDialog>
    </section>
  );
}

type WaitingRoundProps = {
  busy: RoundBusyState; hasBothDrawn: boolean; onBack: () => void;
  onDraw: () => void; onReveal: () => void; round: RoundView;
};

function WaitingRound({ busy, hasBothDrawn, onBack, onDraw, onReveal, round }: WaitingRoundProps) {
  if (!round.ownDrawn) {
    return (
      <div className="round-content draw-first-content">
        <div className="round-envelope-wrap"><Envelope className="round-envelope" /></div>
        <p className="eyebrow">每人一张</p><h2>先抽到自己的那张</h2>
        <p className="body-copy">抽签结果会先保密，等双方都准备好后一起打开。</p>
        <button className="primary-button" type="button" onClick={onDraw} disabled={busy.drawing}>
          {busy.drawing ? "正在抽取…" : "抽一张"}
        </button>
        <button className="text-button" type="button" onClick={onBack}>稍后继续</button>
      </div>
    );
  }
  return (
    <div className="round-content waiting-content">
      <div className="draw-status-grid" aria-label="双方抽签状态">
        <div className="draw-status-item is-done"><Envelope className="status-envelope" /><strong>你</strong><span>已抽好</span></div>
        <div className={`draw-status-item ${round.partnerDrawn ? "is-done" : "is-waiting"}`}>
          <Envelope className="status-envelope" outline={!round.partnerDrawn} /><strong>对方</strong><span>{round.partnerDrawn ? "已抽好" : "还在抽"}</span>
        </div>
      </div>
      <p className="waiting-copy">{hasBothDrawn ? "两张信都准备好了，一起拆开吧。" : "等对方抽好，一起拆开"}</p>
      <div className="round-actions">
        {hasBothDrawn ? (
          <button className="primary-button" type="button" onClick={onReveal} disabled={busy.revealing}>
            {busy.revealing ? "正在打开…" : "一起拆开"}
          </button>
        ) : <button className="text-button" type="button" onClick={onBack}>稍后继续</button>}
      </div>
    </div>
  );
}

function CancelRoundLink({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return <button className="danger-text-button" type="button" onClick={onCancel} disabled={busy}>{busy ? "正在取消…" : "取消本轮"}</button>;
}

type RevealedRoundProps = {
  busy: RoundBusyState; onComplete: () => void; onSelectCard: (cardId: string | null) => void;
  onSelectConfirm: () => void; onRedraw: () => void; onWithdraw: () => void;
  pendingCardId: string | null; round: RoundView; revealOnMount: boolean; exiting: boolean;
};

function RevealedRound({ busy, onComplete, onSelectCard, onSelectConfirm, onRedraw, onWithdraw,
  pendingCardId, round, revealOnMount, exiting,
}: RevealedRoundProps) {
  const cards = [...(round.cards ?? [])].sort((a, b) => a.owner === b.owner ? 0 : a.owner === "self" ? -1 : 1);
  const isCompleted = round.status === "completed";
  const isSelected = Boolean(round.selectedCardId);
  const proposal = round.proposal;
  const anyBusy = busy.deciding || busy.selecting || exiting;
  return (
    <div className={`round-content revealed-content ${exiting ? "is-returning" : ""}`}>
      <RoundCardStage round={round} revealOnMount={revealOnMount} exiting={exiting}>
        {({ final, opening }) => cards.filter((card) => !final || card.id === round.selectedCardId).map((card) => (
          <ResultCard key={card.id} card={card} onSelect={() => onSelectCard(card.id)}
            selected={round.selectedCardId === card.id || proposal?.cardId === card.id || pendingCardId === card.id}
            disabled={isSelected || isCompleted || anyBusy || opening || Boolean(proposal)}
            variant={card.owner} final={final} />
        ))}
      </RoundCardStage>
      <div className="round-actions">
        {exiting ? <p className="selection-hint" role="status">正在收回卡片，准备新的一组…</p> : isCompleted ? (
          <div className="completed-note"><Check size={18} strokeWidth={1.8} /><span>今天完成了，明天再来。</span></div>
        ) : isSelected ? (
          <button className="primary-button" type="button" onClick={onComplete} disabled={busy.completing}>
            {busy.completing ? "正在保存…" : "完成了"}
          </button>
        ) : proposal ? (
          <><p className="selection-hint" role="status">{proposal.requestedBy === "self"
            ? proposal.kind === "redraw" ? "已邀请对方重新抽取，等对方点点头。" : "已邀请对方一起选这张，等对方点点头。"
            : "对方发来一个邀请，等你一起决定。"}</p>
            {proposal.requestedBy === "self" ? <button className="text-button withdraw-proposal" type="button" onClick={onWithdraw} disabled={anyBusy}>撤回邀请</button> : null}</>
        ) : (
          <><p className="redraw-option">不太心动？<button className="redraw-button" type="button" onClick={onRedraw} disabled={anyBusy}>重新抽取</button></p>
            <button className="primary-button" type="button" onClick={onSelectConfirm} disabled={!pendingCardId || anyBusy}>
              {busy.selecting ? "正在邀请…" : pendingCardId ? "就选这一张" : "先选一张"}
            </button></>
        )}
      </div>
    </div>
  );
}

type ResultCardProps = {
  card: RevealedCard; disabled: boolean; onSelect: () => void; selected: boolean;
  variant: "self" | "partner"; final: boolean;
};

function ResultCard({ card, disabled, onSelect, selected, variant, final }: ResultCardProps) {
  const textSize = card.text.length > 12 ? "is-long" : card.text.length > 4 ? "is-medium" : "";
  return (
    <button className={`result-card result-card-${variant} ${selected ? "is-selected" : ""}`} data-card-id={card.id}
      type="button" onClick={onSelect} disabled={disabled} aria-pressed={selected}>
      <span className="result-card-header"><span>{final ? "我们选定了" : card.owner === "self" ? "你抽到" : "对方抽到"}</span>
        <span className={`choice-dot ${selected ? "is-selected" : ""}`} aria-hidden="true">{selected ? <Check size={14} strokeWidth={2} /> : null}</span>
      </span>
      <span className={`result-card-text ${textSize}`}>{card.text}</span>
    </button>
  );
}

type LibraryPanelProps = {
  error: string | null;
  library: LibraryResponse | null;
  loading: boolean;
  notice: string | null;
  onBack: () => void;
  onClearMessage: () => void;
  onMutation: (mutation: LibraryMutation) => Promise<LibraryResponse>;
  onRefresh: () => void;
};

function LibraryPanel({
  error,
  library,
  loading,
  notice,
  onBack,
  onClearMessage,
  onMutation,
  onRefresh,
}: LibraryPanelProps) {
  const [singleText, setSingleText] = useState("");
  const [singleActivate, setSingleActivate] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkActivate, setBulkActivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const batchAllRef = useRef<HTMLInputElement>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [collapsedSections, setCollapsedSections] = useState({ active: false, reserve: false, pending: false, completed: false });
  const toggleSection = (tone: LibrarySectionProps["tone"]) => {
    setCollapsedSections((current) => ({ ...current, [tone]: !current[tone] }));
  };


  const items = useMemo(() => library?.items ?? [], [library?.items]);
  const pendingItems = useMemo(() => items.filter(isPendingReview), [items]);
  const activeItems = useMemo(
    () => items.filter((item) => item.state === "active" && !isPendingReview(item)),
    [items],
  );
  const reserveItems = useMemo(
    () => items.filter((item) => item.state === "reserve" && !isPendingReview(item)),
    [items],
  );
  const completedItems = useMemo(() => items.filter((item) => item.state === "completed"), [items]);
  const batchEligibleIds = useMemo(() => reserveItems.filter((item) => !item.held).map((item) => item.id), [reserveItems]);
  const selectedBatchIds = useMemo(() => {
    const eligible = new Set(batchEligibleIds);
    return batchIds.filter((id) => eligible.has(id));
  }, [batchEligibleIds, batchIds]);
  useEffect(() => {
    if (batchAllRef.current) batchAllRef.current.indeterminate = selectedBatchIds.length > 0 && selectedBatchIds.length < batchEligibleIds.length;
  }, [batchMode, selectedBatchIds.length, batchEligibleIds.length]);


  const runMutation = async (
    mutation: LibraryMutation,
    successMessage?: string,
  ): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    setLocalError(null);
    try {
      await onMutation(mutation);
      if (successMessage) {
        setLocalError(null);
      }
      return true;
    } catch (requestError) {
      setLocalError(errorMessage(requestError, "灵感库暂时无法更新。"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addSingle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = singleText.trim();
    if (!text) {
      setLocalError("请先写下一条灵感。 ");
      return;
    }
    const saved = await runMutation({ action: "add", text, activate: singleActivate }, "已添加");
    if (saved) setSingleText("");
  };

  const addBulk = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const texts = bulkText
      .split(/\r?\n/)
      .map((text) => text.trim())
      .filter(Boolean);
    if (!texts.length) {
      setLocalError("请至少写下一行灵感。 ");
      return;
    }
    const saved = await runMutation({ action: "bulkAdd", texts, activate: bulkActivate }, "已批量添加");
    if (saved) setBulkText("");
  };

  const activateItems = async (ids: string[]) => {
    await runMutation({ action: "activate", ids });
  };

  const reserveItemsMutation = async (ids: string[]) => {
    await runMutation({ action: "reserve", ids });
  };

  const saveReading = async (item: LibraryItem) => {
    const text = editingText.trim();
    if (!text) {
      setLocalError("请填写灵感内容。 ");
      return;
    }
    const saved = await runMutation({ action: "edit", id: item.id, text, confirmReading: isPendingReview(item) });
    if (saved) {
      setEditingId(null);
      setEditingText("");
    }
  };

  const editItem = (item: LibraryItem) => {
    setEditingId(item.id);
    setEditingText(item.text || item.tentativeText || "");
    setLocalError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
    setLocalError(null);
  };

  const deleteItem = async (item: LibraryItem) => {
    if (saving || item.held) return;
    const text = item.text || "这条灵感";
    const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    if (!window.confirm(`确定删除「${preview}」吗？\n删除后无法撤销，已有抽签记录会保留。`)) return;
    if (await runMutation({ action: "delete", id: item.id })) {
      if (editingId === item.id) cancelEdit();
    }
  };

  const activateSelected = async () => {
    if (saving || selectedBatchIds.length === 0) return;
    if (await runMutation({ action: "activate", ids: selectedBatchIds })) {
      setBatchIds([]);
      setBatchMode(false);
    }
  };

  const toggleBatchItem = (id: string, checked: boolean) => {
    if (saving || !batchEligibleIds.includes(id)) return;
    setBatchIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const importItems = toImportItems(parsed);
      if (!importItems.length) {
        setLocalError("这个 JSON 里没有可导入的 items。 ");
        return;
      }
      await runMutation({ action: "import", items: importItems });
    } catch (requestError) {
      setLocalError(
        requestError instanceof SyntaxError
          ? "JSON 格式无法读取，请选择导出的 planning JSON 文件。"
          : errorMessage(requestError, "导入失败，请稍后再试。"),
      );
    }
  };

  const displayedError = localError || error;

  return (
    <main className="life-draw-shell">
      <div className="life-draw-app library-app">
        <header className="library-header">
          <button className="icon-button back-button" type="button" onClick={onBack} aria-label="返回首页">
            <ArrowLeft size={25} strokeWidth={1.55} />
          </button>
          <div>
            <h1>灵感库</h1>
          </div>
          <button className="icon-button" type="button" onClick={onRefresh} aria-label="刷新灵感库">
            <RefreshCw size={19} strokeWidth={1.55} />
          </button>
        </header>

        <MessageBanner error={displayedError} notice={notice} onClear={() => { setLocalError(null); onClearMessage(); }} />

        <div className="library-scroll-area">
          <section className="library-intro">
            <p>这里可以看到所有候选内容。抽签过程中，词会暂时保密。</p>
            <a className="export-link" href="/api/export" download="life-draw-library.json">
              <Download size={16} strokeWidth={1.6} />
              导出 JSON
            </a>
          </section>

          <section className="library-tools" aria-label="添加灵感">
            <details className="library-details" open>
              <summary>
                <span className="summary-title">
                  <Plus size={17} strokeWidth={1.6} />
                  添加一条
                </span>
                <span className="summary-note">手动输入</span>
              </summary>
              <form className="library-form" onSubmit={addSingle}>
                <textarea
                  value={singleText}
                  onChange={(event) => setSingleText(event.target.value)}
                  placeholder="写下一件今天可能想做的小事"
                  rows={2}
                  maxLength={200}
                />
                <div className="form-row">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={singleActivate}
                      onChange={(event) => setSingleActivate(event.target.checked)}
                    />
                    <span>直接放入可抽池</span>
                  </label>
                  <button className="small-primary-button" type="submit" disabled={saving}>
                    {saving ? "保存中…" : "添加"}
                  </button>
                </div>
              </form>
            </details>

            <details className="library-details">
              <summary>
                <span className="summary-title">
                  <Clipboard size={16} strokeWidth={1.6} />
                  批量添加
                </span>
                <span className="summary-note">一行一条</span>
              </summary>
              <form className="library-form" onSubmit={addBulk}>
                <textarea
                  value={bulkText}
                  onChange={(event) => setBulkText(event.target.value)}
                  placeholder={"散步十分钟\n做一顿新的晚饭\n一起看一集剧"}
                  rows={4}
                  maxLength={4000}
                />
                <div className="form-row">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={bulkActivate}
                      onChange={(event) => setBulkActivate(event.target.checked)}
                    />
                    <span>直接放入可抽池</span>
                  </label>
                  <button className="small-primary-button" type="submit" disabled={saving}>
                    {saving ? "保存中…" : "批量添加"}
                  </button>
                </div>
              </form>
            </details>

            <details className="library-details">
              <summary>
                <span className="summary-title">
                  <Upload size={16} strokeWidth={1.6} />
                  导入 JSON
                </span>
                <span className="summary-note">默认放入备用</span>
              </summary>
              <div className="import-box">
                <p>支持 planning JSON 的顶层 items，也支持从本空间导出的 JSON。原词、暂读和来源 ID 会保留。</p>
                <input
                  ref={importInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportFile}
                />
                <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()} disabled={saving}>
                  <FileJson size={16} strokeWidth={1.6} />
                  选择 JSON 文件
                </button>
              </div>
            </details>
          </section>

          {loading ? (
            <div className="library-loading">正在读取灵感库…</div>
          ) : (
            <>
              <LibrarySection
                emptyText="还没有可抽的灵感。"
                items={activeItems}
                busy={saving}
                editingId={editingId}
                editingText={editingText}
                onChangeEditingText={setEditingText}
                onEdit={editItem}
                onCancelEdit={cancelEdit}
                onSaveReading={saveReading}
                onDelete={deleteItem}
                onMoveToReserve={reserveItemsMutation}
                title="可抽"
                collapsed={collapsedSections.active}
                onToggle={() => toggleSection("active")}
                tone="active"
              />
              <LibrarySection
                emptyText="备用区是空的。"
                items={reserveItems}
                busy={saving}
                editingId={editingId}
                editingText={editingText}
                onChangeEditingText={setEditingText}
                onEdit={editItem}
                onCancelEdit={cancelEdit}
                onSaveReading={saveReading}
                onDelete={deleteItem}
                actions={!batchMode && reserveItems.length > 0 ? (
                  <button className="mini-button" type="button" disabled={saving || !batchEligibleIds.length}
                    onClick={() => { cancelEdit(); setBatchIds([]); setBatchMode(true); }}>批量启用</button>
                ) : null}
                toolbar={batchMode ? (
                  <div className="reserve-batch-toolbar" aria-label="批量启用备用灵感">
                    <div className="reserve-batch-summary">
                      <label className="check-label"><input ref={batchAllRef} type="checkbox"
                        checked={batchEligibleIds.length > 0 && selectedBatchIds.length === batchEligibleIds.length}
                        disabled={saving || !batchEligibleIds.length}
                        onChange={(event) => setBatchIds(event.target.checked ? batchEligibleIds : [])} /><span>全选</span></label>
                      <span className="batch-selection-count" aria-live="polite">已选 {selectedBatchIds.length} 条</span>
                    </div>
                    <div className="reserve-batch-actions">
                      <button className="small-primary-button" type="button" disabled={saving || selectedBatchIds.length === 0}
                        onClick={activateSelected}>{saving ? "正在启用…" : `启用所选（${selectedBatchIds.length}）`}</button>
                      <button className="mini-button muted-mini-button" type="button" disabled={saving}
                        onClick={() => { setBatchMode(false); setBatchIds([]); }}>取消</button>
                    </div>
                  </div>
                ) : null}
                selectedIds={selectedBatchIds}
                onToggleSelection={batchMode ? toggleBatchItem : undefined}
                onActivate={activateItems}
                title="备用"
                collapsed={collapsedSections.reserve}
                onToggle={() => toggleSection("reserve")}
                tone="reserve"
              />
              <LibrarySection
                emptyText="没有待核对内容。"
                items={pendingItems}
                busy={saving}
                onCancelEdit={cancelEdit}
                editingId={editingId}
                editingText={editingText}
                onChangeEditingText={setEditingText}
                onEdit={editItem}
                onSaveReading={saveReading}
                title="待核对"
                collapsed={collapsedSections.pending}
                onToggle={() => toggleSection("pending")}
                tone="pending"
              />
              {completedItems.length ? (
                <LibrarySection
                  emptyText="还没有完成记录。"
                  items={completedItems}
                  title="已完成"
                  collapsed={collapsedSections.completed}
                  onToggle={() => toggleSection("completed")}
                  tone="completed"
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

type LibrarySectionProps = {
  collapsed: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  selectedIds?: string[];
  onToggleSelection?: (id: string, checked: boolean) => void;
  busy?: boolean;
  onCancelEdit?: () => void;
  onDelete?: (item: LibraryItem) => void;
  editingId?: string | null;
  editingText?: string;
  emptyText: string;
  items: LibraryItem[];
  onActivate?: (ids: string[]) => void;
  onChangeEditingText?: (value: string) => void;
  onEdit?: (item: LibraryItem) => void;
  onMoveToReserve?: (ids: string[]) => void;
  onSaveReading?: (item: LibraryItem) => void;
  title: string;
  tone: "active" | "reserve" | "pending" | "completed";
};

function LibrarySection({
  collapsed,
  onToggle,
  actions,
  toolbar,
  selectedIds,
  onToggleSelection,
  busy,
  onCancelEdit,
  onDelete,
  editingId,
  editingText,
  emptyText,
  items,
  onActivate,
  onChangeEditingText,
  onEdit,
  onMoveToReserve,
  onSaveReading,
  title,
  tone,
}: LibrarySectionProps) {
  const contentId = useId();
  return (
    <section className={`library-section library-section-${tone}`}>
      <div className="library-section-heading">
        <h2>{title}</h2>
        <span>{items.length}</span>
        <div className="library-section-actions">
          {!collapsed ? actions : null}
          <button className="mini-button muted-mini-button library-section-toggle" type="button"
            aria-expanded={!collapsed} aria-controls={contentId}
            aria-label={`${collapsed ? "展开" : "收起"}${title}栏目`} onClick={onToggle}>
            {collapsed ? "展开" : "收起"}
            <ChevronDown size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="library-section-content" id={contentId} hidden={collapsed}>
      {toolbar}
      {!items.length ? (
        <p className="library-empty">{emptyText}</p>
      ) : (
        <div className="library-list">
          {items.map((item) => (
            <LibraryItemRow
              showProvenance={tone === "pending" || tone === "completed"}
              selectedForBatch={Boolean(selectedIds?.includes(item.id))}
              onToggleSelection={onToggleSelection}
              busy={busy}
              onCancelEdit={onCancelEdit}
              onDelete={onDelete}
              editing={editingId === item.id}
              editingText={editingText || ""}
              item={item}
              key={item.id}
              onActivate={onActivate}
              onChangeEditingText={onChangeEditingText}
              onEdit={onEdit}
              onMoveToReserve={onMoveToReserve}
              onSaveReading={onSaveReading}
            />
          ))}
        </div>
      )}
      </div>
    </section>
  );
}

type LibraryItemRowProps = {
  showProvenance: boolean;
  selectedForBatch: boolean;
  onToggleSelection?: (id: string, checked: boolean) => void;
  busy?: boolean;
  onCancelEdit?: () => void;
  onDelete?: (item: LibraryItem) => void;
  editing: boolean;
  editingText: string;
  item: LibraryItem;
  onActivate?: (ids: string[]) => void;
  onChangeEditingText?: (value: string) => void;
  onEdit?: (item: LibraryItem) => void;
  onMoveToReserve?: (ids: string[]) => void;
  onSaveReading?: (item: LibraryItem) => void;
};

function LibraryItemRow({
  showProvenance,
  selectedForBatch,
  onToggleSelection,
  busy,
  onCancelEdit,
  onDelete,
  editing,
  editingText,
  item,
  onActivate,
  onChangeEditingText,
  onEdit,
  onMoveToReserve,
  onSaveReading,
}: LibraryItemRowProps) {
  const text = item.text || item.tentativeText || "（暂无可显示文字）";
  const tentative = !item.text && Boolean(item.tentativeText);
  const hasMeta = tentative || item.needsUsageConfirmation || item.held || (showProvenance && (item.sourceId || item.notes));

  return (
    <article className="library-item-row" data-item-id={item.id} data-batch-selected={onToggleSelection ? selectedForBatch : undefined}>
      <div className="library-item-copy">
        {onToggleSelection ? (
          <label className="library-batch-item">
            <input type="checkbox" checked={selectedForBatch} disabled={busy || item.held}
              onChange={(event) => onToggleSelection(item.id, event.target.checked)} />
            <span className="library-item-text">{text}</span>
          </label>
        ) : <p className={`library-item-text ${tentative ? "is-tentative" : ""}`}>{text}</p>}
        {hasMeta ? <div className="library-item-meta">
          {tentative ? <span className="item-badge warning-badge">暂读</span> : null}
          {item.needsUsageConfirmation ? <span className="item-badge warning-badge">需确认用途</span> : null}
          {showProvenance && item.sourceId ? <span>来源 {item.sourceId}</span> : null}
          {showProvenance && item.notes ? <span>{item.notes}</span> : null}
          {item.held ? (
            <span className="item-badge held-badge">
              <LockKeyhole size={12} /> 本轮占用
            </span>
          ) : null}
        </div> : null}
      </div>
      {!editing && !onToggleSelection ? <div className="library-item-actions">
        {onEdit ? (
          <button className="mini-button" type="button" onClick={() => onEdit(item)} disabled={busy || item.held}>
            {isPendingReview(item) ? "核对文字" : "编辑"}
          </button>
        ) : null}
        {!item.held && onActivate ? (
          <button className="mini-button" type="button" onClick={() => onActivate([item.id])} disabled={busy}>启用</button>
        ) : null}
        {!item.held && onMoveToReserve ? (
          <button className="mini-button muted-mini-button" type="button" onClick={() => onMoveToReserve([item.id])} disabled={busy}>放回备用</button>
        ) : null}
        {onDelete ? (
          <button className="mini-button destructive-mini-button" type="button" onClick={() => onDelete(item)} disabled={busy || item.held}>删除</button>
        ) : null}
      </div> : null}
      {editing && onChangeEditingText && onSaveReading ? (
        <form
          className="reading-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveReading(item);
          }}
        >
          <label className="field-label" htmlFor={`reading-${item.id}`}>
            {isPendingReview(item) ? "核对后可抽取的文字" : "灵感内容"}
          </label>
          <textarea
            id={`reading-${item.id}`}
            value={editingText}
            onChange={(event) => onChangeEditingText(event.target.value)}
            maxLength={1000}
            rows={3}
            disabled={busy || item.held}
            autoFocus
          />
          <div className="library-edit-actions">
            <button className="small-primary-button" type="submit" disabled={busy || item.held}>
              {busy ? "保存中…" : isPendingReview(item) ? "确认并保留到备用" : "保存修改"}
            </button>
            <button className="mini-button muted-mini-button" type="button" onClick={onCancelEdit} disabled={busy}>取消</button>
          </div>
        </form>
      ) : null}
    </article>
  );
}
