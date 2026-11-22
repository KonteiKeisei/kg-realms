// A watch's encounter roll, as the camp view shows it (0.97.9: no die animation; the roll is made in
// the background and its result shown at once).
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

function outcome({ roll, die = 20, hidden = false, harmless = false, scheduled = false, text = "" }) {
  const hit = !hidden && roll === 1;
  const what = hidden ? "" : scheduled ? "Scheduled encounter" : `${esc(roll)} on 1d${die}${harmless && hit ? " · Harmless failure" : ""}`;
  return `<div class="cs-watch-outcome landed ${hit ? "hit" : ""}">
    ${what ? `<span class="cs-watch-roll-label">${what}</span>` : ""}
    <p class="cs-watch-outcome-text">${hidden ? "Watch resolved." : hit ? "Something lurks just beyond the firelight." : esc(text || "A quiet watch.")}</p>${hit && harmless ? `<p class="cs-watch-harmless">${esc(text)}</p>` : ""}</div>`;
}

/** The moment between the GM asking for the roll and its result being saved. */
export function rollingWatchHtml(reveal) {
  return `<div class="cs-watch-reveal" role="status" aria-live="polite" data-reveal="${esc(reveal.id)}"><p class="cs-watch-pending">Resolving the watch…</p></div>`;
}

export function watchResultsHtml(results, { hidden = false } = {}) {
  return `<div class="cs-watch-results" role="status" aria-live="polite">${hidden ? outcome({ hidden: true }) : results.map((r) => outcome(r)).join("")}</div>`;
}

/** Kept for callers from 0.97.9's first draft: markup without a roll start (there is none now). */
export const withoutRollDelay = (html) => html;
