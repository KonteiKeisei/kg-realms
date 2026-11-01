// The map editor's Practice tab: demonstrations that change nothing, not the route, the clock, the
// travel log or the chat. The first is the practice night: the camp made here as at the end of a
// day's travel (the rest's hours, the tasks and their DCs, the watch order and shared shifts, the
// night's encounters and scenes), starting from the journey's, then the real camp scene
// (ui-camp.mjs) plays it on a clock of its own. The GM rolls for everyone, with no chat card; no
// ration is given. With Players see the practice, the scene plays on their screens too.

export class PracticeTab {
  /** camp: the travel panel's CampPanel (the party, its watch order, the camp scene). */
  constructor({ camp }) {
    this.camp = camp;
    this.active = false;
    this.panel = null;
    this.opts = { players: false };
    // The camp being made changes here; the scene ends the practice (Break camp, End practice).
    camp.onPracticeEnd = () => this.#render();
    camp.onPracticeChange = () => this.#render();
  }

  status() {
    const P = this.camp.practice;
    return P?.setup ? { hint: "Practice night · make the camp, then begin; nothing is kept", esc: "leaves editing", tip: "" }
      : P ? { hint: "Practice night · the camp scene is on screen; nothing is kept", esc: "leaves editing", tip: "" }
      : { hint: "Practice: try things out here; nothing is kept", esc: "leaves editing", tip: "" };
  }

  open() {
    if (this.active || !game.user.isGM) return;
    this.active = true;
    this.panel = document.createElement("div");
    this.panel.className = "kgr-tab kgr-practice kgr-camp-box";
    (this.host ?? document.body).append(this.panel);
    this.panel.addEventListener("click", (e) => this.#click(e));
    this.panel.addEventListener("change", (e) => this.#change(e));
    // The watch order dragged, a scene dropped on the camp or a watch.
    this.panel.addEventListener("dragstart", (e) => this.camp.dragStart(e));
    this.panel.addEventListener("dragover", (e) => { if (this.camp.dragOver(e)) return; if (e.target.closest?.("[data-camp-drop]")) e.preventDefault(); });
    this.panel.addEventListener("drop", (e) => this.camp.drop(e));
    this.#render();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.camp.endPractice();
    this.panel?.remove();
    this.panel = null;
  }

  #render() {
    this.onStatus?.();
    if (!this.active || !this.panel) return;
    // Typing in it (an hour, a DC): the redraw waits for the change.
    if (this.panel.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
    const P = this.camp.practice, body = !P ? this.#startHtml() : P.setup ? this.camp.practiceSetupHtml() : this.#runningHtml();
    const intro = `<p class="hint">Demonstrations that change nothing: not the route, the clock, the travel log or the chat. Only you see them, unless you show the players.</p>`;
    // The redraw keeps the tab where it was scrolled to (whichever box around it scrolls).
    const kept = [];
    for (let el = this.panel; el && el !== document.body; el = el.parentElement) if (el.scrollTop) kept.push([el, el.scrollTop]);
    this.panel.innerHTML = `${intro}<section class="kgr-enc-box kgr-practice-night"><span class="cap">Practice night</span>${body}</section>`;
    for (const [el, top] of kept) el.scrollTop = top;
  }

  #startHtml() {
    const adv = this.camp.advanced ? "" : ` Turn on Advanced watches in the settings to practise the camp's tasks too.`;
    return `<p class="hint">Make a camp as at the end of a day's travel, then play its night in the camp scene: the rest's hours, each one's task and its DC, the watch order and shared shifts, the night's encounters (rolled, or in a given watch) and its scenes. It starts from the journey's camp; change anything, nothing is kept. You roll for everyone, with no chat card; no ration is given.${adv}</p>
      <label class="kgr-practice-check"><input type="checkbox" data-p="players" ${this.opts.players ? "checked" : ""}> Players see the practice <small>(the camp scene on their screens, to watch)</small></label>
      <div class="row"><button data-p="begin" class="primary grow" ${this.camp.members().length ? "" : "disabled"}><i class="fa-solid fa-campground"></i> Make a practice camp</button></div>`;
  }

  #runningHtml() {
    return `<p class="hint">The practice night is on screen${this.camp.practice.players ? ", and on the players' screens" : ""}. Step through it there; Break camp or End practice finishes it.</p>
      <div class="row"><button data-p="end" class="grow"><i class="fa-solid fa-xmark"></i> End practice</button></div>`;
  }

  #click(e) {
    const camp = e.target.closest("button[data-camp]");
    if (camp) return this.camp.click(camp);
    const b = e.target.closest("[data-p]");
    if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
    if (b.dataset.p === "begin") return this.camp.startPractice(this.opts);
    if (b.dataset.p === "end") return this.camp.endPractice();
  }

  #change(e) {
    const t = e.target;
    // Let go of the field first, so the camp's redraw is not held for it.
    if (t.dataset?.camp) { t.blur(); return this.camp.change(t); }
    if (t.dataset?.p === "players") this.opts.players = t.checked;
  }
}
