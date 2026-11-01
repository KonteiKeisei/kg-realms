import { WATCH_ROLL_MS } from "./watch-outcomes.mjs";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const shape = '<svg viewBox="0 0 120 132" aria-hidden="true"><path class="die-shell" d="M60 3 113 34V98L60 129 7 98V34Z"/><path class="die-facets" d="M60 3 30 49 7 34M60 3 90 49 113 34M7 98 30 49H90L113 98M7 98 60 91 113 98M30 49 60 91 90 49M60 91V129"/></svg>';

function dieFace({ roll, die = 20, rolling = false, hidden = false, harmless = false, scheduled = false, text = "", delay = 0 }) {
  const hit = !rolling && !hidden && roll === 1;
  const numbers = Array.from({ length: 12 }, (_, i) => 1 + i % Math.max(1, Math.min(20, die)));
  return `<div class="cs-watch-outcome ${hit ? "hit" : ""} ${rolling ? "rolling" : "landed"}" style="--watch-roll-delay:${delay}ms;--watch-roll-duration:${WATCH_ROLL_MS}ms">
    <div class="cs-watch-die" ${rolling || hidden ? 'aria-hidden="true"' : `aria-label="Rolled ${roll} on 1d${die}"`}>${shape}<span class="cs-watch-number">${rolling ? `<span class="cs-watch-faces">${numbers.map((n) => `<span>${hidden ? "?" : n}</span>`).join("")}</span>` : hidden ? "?" : esc(roll)}</span></div>
    ${!rolling && !hidden ? `<span class="cs-watch-roll-label">${scheduled ? "Scheduled encounter" : `1d${die}`}${harmless && hit ? " · Harmless failure" : ""}</span>` : ""}
    <p class="cs-watch-outcome-text">${rolling ? "Rolling..." : hidden ? "Watch resolved." : hit ? "Something lurks just beyond the firelight." : esc(text || "A quiet watch.")}</p>${hit && harmless ? `<p class="cs-watch-harmless">${esc(text)}</p>` : ""}</div>`;
}

export function rollingWatchHtml(reveal, dice, { hidden = false } = {}) {
  return `<div class="cs-watch-reveal" role="status" aria-live="polite" data-reveal="${esc(reveal.id)}">${dice.map((die) => dieFace({ die, rolling: true, hidden, delay: -Math.max(0, Date.now() - (reveal.until - WATCH_ROLL_MS)) })).join("")}</div>`;
}

export function watchResultsHtml(results, { hidden = false } = {}) {
  return `<div class="cs-watch-results" role="status" aria-live="polite">${hidden ? dieFace({ hidden: true }) : results.map((r) => dieFace(r)).join("")}</div>`;
}
