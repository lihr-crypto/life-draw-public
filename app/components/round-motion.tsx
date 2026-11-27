"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { RoundView } from "../contracts";

const EASE = "cubic-bezier(.22,.78,.22,1)";

function OpeningEnvelope() {
  return (
    <div className="motion-envelope" aria-hidden="true">
      <div className="motion-envelope-back" />
      <div className="motion-envelope-flap">
        <svg viewBox="0 0 154 62"><path d="M1 1L77 61 153 1" /></svg>
      </div>
      <div className="motion-envelope-front" />
      <svg className="motion-envelope-lines" viewBox="0 0 154 101">
        <path d="M1 100L62 49M153 100L92 49" />
        <rect x=".5" y=".5" width="153" height="100" rx="6" />
      </svg>
      <div className="motion-envelope-seal" />
    </div>
  );
}

/** Motion uses only an already revealed server projection. Reloads render the stable state. */
export function RoundCardStage({
  round,
  revealOnMount,
  exiting,
  children,
}: {
  round: RoundView;
  revealOnMount: boolean;
  exiting: boolean;
  children: (options: { final: boolean; opening: boolean }) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState(() => revealOnMount && !round.selectedCardId &&
    !(typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches));
  const [settled, setSettled] = useState(round.selectedCardId);
  const flipFrom = useRef<DOMRect | null>(null);
  const animations = useRef<Animation[]>([]);
  const ghosts = useRef<Element[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useLayoutEffect(() => {
    const stage = root.current;
    if (!stage || !revealOnMount || round.selectedCardId) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const animate = (el: Element, frames: Keyframe[], duration: number, delay = 0) => {
      const animation = el.animate(frames, { duration, delay, fill: "both", easing: EASE });
      animations.current.push(animation);
      return animation;
    };
    const envelopes = [...stage.querySelectorAll<HTMLElement>(".motion-envelope")];
    const cards = [...stage.querySelectorAll<HTMLElement>(".result-card")];
    envelopes.forEach((envelope, i) => {
      animate(envelope.querySelector(".motion-envelope-seal")!, [
        { opacity: 1, transform: "translateY(0) scale(1)" },
        { opacity: 0, transform: "translateY(14px) scale(.82)" },
      ], 300, i * 90);
      animate(envelope.querySelector(".motion-envelope-flap")!, [
        { transform: "rotateX(0deg)" }, { transform: "rotateX(180deg)" },
      ], 540, 180 + i * 90);
      animate(envelope, [{ opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(30px)" }], 470, 950 + i * 90);
      const card = cards[i];
      if (!card) return;
      const target = envelope.getBoundingClientRect();
      const from = card.getBoundingClientRect();
      const x = target.left + target.width / 2 - from.left - from.width / 2;
      const y = target.top + target.height / 2 - from.top - from.height / 2;
      const scale = target.width * .84 / card.offsetWidth;
      animate(card, [
        { opacity: 0, transform: `translate(${x}px,${y}px) scale(${scale}) rotate(0deg)`, offset: 0 },
        { opacity: 1, transform: `translate(${x}px,${y - 76}px) scale(${scale}) rotate(0deg)`, offset: .28 },
        { opacity: 1, transform: getComputedStyle(card).transform, offset: 1 },
      ], 1080, 540 + i * 90);
    });
    const timer = setTimeout(() => {
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
      setOpening(false);
    }, 1810);
    timers.current.push(timer);
    // This effect intentionally describes the initial reveal only. Polling must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const stage = root.current;
    const id = round.selectedCardId;
    if (!stage || !id) return;
    if (opening) {
      timers.current.forEach(clearTimeout);
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
      // Synchronize the measured DOM before the single-card FLIP transition.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpening(false);
    }
    const winner = [...stage.querySelectorAll<HTMLElement>(".result-card")].find((card) => card.dataset.cardId === id);
    if (!winner) return;
    if (!settled) {
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) {
        flipFrom.current = winner.getBoundingClientRect();
        const loser = [...stage.querySelectorAll<HTMLButtonElement>(".result-card")].find((card) => card.dataset.cardId !== id);
        if (loser) {
          const bounds = loser.getBoundingClientRect();
          const clone = loser.cloneNode(true) as HTMLButtonElement;
          clone.disabled = true;
          clone.tabIndex = -1;
          clone.setAttribute("aria-hidden", "true");
          clone.classList.add("motion-card-ghost");
          Object.assign(clone.style, {
            position: "fixed", zIndex: "25", margin: "0", pointerEvents: "none",
            left: `${bounds.left + (bounds.width - loser.offsetWidth) / 2}px`,
            top: `${bounds.top + (bounds.height - loser.offsetHeight) / 2}px`,
            width: `${loser.offsetWidth}px`, height: `${loser.offsetHeight}px`,
            minHeight: "0", transform: getComputedStyle(loser).transform,
          });
          document.body.appendChild(clone);
          ghosts.current.push(clone);
          const direction = loser.classList.contains("result-card-self") ? -1 : 1;
          const animation = clone.animate([
            { opacity: 1, transform: getComputedStyle(loser).transform },
            { opacity: 0, transform: `translate(${direction * 80}px,45px) scale(.94) rotate(${direction * 12}deg)` },
          ], { duration: 560, fill: "forwards", easing: EASE });
          animations.current.push(animation);
          void animation.finished.then(() => clone.remove()).catch(() => clone.remove());
        }
      }
      // The second layout pass measures the final DOM before the browser paints.
      setSettled(id);
    } else if (flipFrom.current) {
      const before = flipFrom.current;
      flipFrom.current = null;
      const after = winner.getBoundingClientRect();
      const fromRotation = winner.classList.contains("result-card-self") ? -3 : 2;
      const animation = winner.animate([
        { transform: `translate(${before.left - after.left}px,${before.top - after.top}px) rotate(${fromRotation}deg)` },
        { transform: "translate(0,0) rotate(-1.2deg)" },
      ], { duration: 850, delay: 150, fill: "both", easing: EASE });
      animations.current.push(animation);
      void animation.finished.then(() => animation.cancel()).catch(() => {});
    }
  }, [round.selectedCardId, settled, opening]);

  useLayoutEffect(() => () => {
    timers.current.forEach(clearTimeout);
    animations.current.forEach((animation) => animation.cancel());
    ghosts.current.forEach((ghost) => ghost.remove());
  }, []);

  const long = round.cards?.some((card) => card.text.length > 12);
  return (
    <div ref={root} className={`result-cards ${long ? "has-long-text" : ""} ${settled ? "is-final" : ""} ${opening ? "is-opening" : ""} ${exiting ? "is-exiting" : ""}`} aria-busy={opening || exiting}>
      {opening ? <div className="opening-envelope-pair"><OpeningEnvelope /><OpeningEnvelope /></div> : null}
      {children({ final: Boolean(settled), opening })}
    </div>
  );
}
