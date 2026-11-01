import {groupActor} from './party-groups.mjs';
const MODULE = "kg-realms";
const text = (v) => typeof v === "string" ? v : "";

/** A placed actor retains its compendium source, including actors imported before designation. */
export function matchesPartyToken(token, uuid) {
  const doc = token.document, actor = token.actor ?? doc.actor;
  return [doc.uuid, actor?.uuid, actor?._stats?.compendiumSource, actor?.flags?.core?.sourceId,
    actor?.id ? `Actor.${actor.id}` : null, doc.actorId ? `Actor.${doc.actorId}` : null].includes(uuid);
}

export function selectPartyTokens(scene, tokens, globalActor = "") {
  tokens=tokens.filter(groupActor);
  if(scene?.partyId)return tokens.filter(t=>(t.actor??t.document.actor)?.id===scene.partyId);
  for (const uuid of [text(scene?.getFlag(MODULE, "partyToken")), text(globalActor)]) {
    if (!uuid) continue;
    const found = tokens.filter((t) => matchesPartyToken(t, uuid));
    if (found.length) return found;
  }
  const named = tokens.filter((t) => /\bparty\b/i.test(t.document.name ?? t.name ?? ""));
  return named.length ? named : tokens;
}

/** Resolve and validate a sidebar/compendium drop without importing or creating an actor. */
export async function partyReference(data, { scene } = {}) {
  if (!["Actor", "Token"].includes(data?.type) || !data.uuid) throw new Error("Drop a group actor from the sidebar or a compendium, or a token from this scene.");
  const doc = await fromUuid(data.uuid);
  if (doc?.documentName === "Actor" && doc.type === "group" && !doc.getFlag?.(MODULE,"party")?.retired) return { uuid: doc.uuid, name: doc.name };
  if (doc?.documentName === "Token" && scene && doc.parent?.id === scene.id && doc.actor?.type === "group") return { uuid: doc.uuid, name: doc.name };
  throw new Error(scene ? "Choose a group actor or its token on this scene." : "The global designation requires a group actor from the sidebar or a compendium.");
}

/** Scene Basics is a content tab. Ambience also has a navigation item named "basic". */
export function scenePartyPicker(root, scene) {
  if (!root || !scene) return;
  const basics = root.querySelector('.tab[data-tab="basics"][data-group="sheet"]') ?? root.querySelector('.tab[data-tab="basics"]');
  const form = root.matches?.('form') ? root : root.querySelector('form') ?? root.querySelector('.window-content.standard-form');
  const target = basics ?? (!root.querySelector('.tab[data-tab]') ? form : null);
  if (!target) return;
  let field = root.querySelector('[data-kgr-party-scene]');
  if (!field) {
    field = document.createElement('fieldset'); field.dataset.kgrPartyScene = 'true';
    field.innerHTML = '<legend>KG Realms party token</legend><div class="form-group"><label>Scene override</label><div class="form-fields"><input type="text" name="flags.kg-realms.partyToken"></div><p class="hint">Overrides the global party actor on this scene. Drop an actor, or use a selected token. Clear to use the global designation and automatic fallback.</p></div>';
    const input = field.querySelector('input'); input.value = scene.getFlag(MODULE, 'partyToken') ?? '';
    input.id = `kgr-party-token-${scene.id}`; field.querySelector('label').htmlFor = input.id;
  }
  field.classList.add('kgr-party-scene');
  target.append(field); partyPicker(field.querySelector('input'), { scene });
  return field;
}

/** Keep the form's native save workflow; a drop edits the input and never writes behind it. */
export function partyPicker(input, { scene } = {}) {
  if (!input || input.dataset.kgrPartyPicker) return;
  input.dataset.kgrPartyPicker = "true";
  const box = document.createElement("div"); box.className = "kgr-party-picker";
  const label = document.createElement("span"); label.className = "kgr-party-name"; label.setAttribute("aria-live", "polite");
  const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "Clear";
  input.before(box); box.append(label, clear, input); input.type = "hidden";
  let revision = 0;
  const show = async () => {
    const current = ++revision, uuid = input.value;
    let doc = null; try { if (uuid) doc = await fromUuid(uuid); } catch { /* no longer available */ }
    if (current !== revision) return;
    label.textContent = doc?.name ?? (uuid ? `Unavailable: ${uuid}` : scene ? "Drop a group actor or select its scene token" : "Drop a group actor from the sidebar or a compendium");
    clear.disabled = !uuid;
  };
  const set = (uuid) => { input.value = uuid; input.dispatchEvent(new Event("change", { bubbles: true })); show(); };
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("over"); });
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", async (e) => {
    e.preventDefault(); e.stopPropagation(); box.classList.remove("over");
    try {
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(e);
      const ref = await partyReference(data, { scene });
      if (box.isConnected) set(ref.uuid);
    } catch (err) { ui.notifications.warn(`KG Realms: ${err.message}`); }
  });
  clear.addEventListener("click", () => set(""));
  if (scene) {
    const selected = document.createElement("button"); selected.type = "button"; selected.textContent = "Use selected token";
    selected.addEventListener("click", () => {
      const tokens = canvas.scene?.id === scene.id ? canvas.tokens?.controlled ?? [] : [];
      if (tokens.length !== 1) return ui.notifications.warn("KG Realms: select one token on this scene first.");
      if(tokens[0].actor?.type!=="group")return ui.notifications.warn("KG Realms party tokens require a group actor.");
      set(tokens[0].document.uuid);
    });
    box.insertBefore(selected, clear);
  }
  show();
}
