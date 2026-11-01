/** Restore after sizing the new contents, before paint. A newer redraw supersedes the callback. */
export function captureScroll(root, selectors = [":scope > .body"]) {
  return [{ selector: null, el: root }, ...selectors.map((selector) => ({ selector, el: root.querySelector(selector) }))]
    .filter((s) => s.el).map(({ selector, el }) => ({ selector, top: el.scrollTop, left: el.scrollLeft }));
}

export function restoreScroll(root, saved) {
  const generation = root.kgrScrollGeneration = (root.kgrScrollGeneration ?? 0) + 1;
  const apply = () => {
    if (root.kgrScrollGeneration !== generation || root.isConnected === false) return;
    for (const s of saved) {
      const el = s.selector ? root.querySelector(s.selector) : root;
      if (el) { el.scrollTop = s.top; el.scrollLeft = s.left; }
    }
  };
  apply();
  globalThis.requestAnimationFrame?.(apply);
}
