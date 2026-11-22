// Skill challenges (0.97.0): where they hook into Foundry.
//  - The GM opens the builder from the scene controls (Token tools, "Skill challenge"), the Scenes
//    sidebar's menu, or Scene Config, on a Site or local map (a theater or battlemap scene). Realm and
//    region maps don't take them.
//  - Everyone looking at a scene with a challenge under way sees its panel, kept up to date as the scene's
//    flag changes; a player's rolls and spell requests reach the primary GM over the module socket.
//  - Macros: game.modules.get("kg-realms").api.challenges: open(scene), run(scene), end(scene).
import { ChallengeBuilder, sceneChallenge } from "./builder.mjs";
import { ChallengeRun, sceneRun } from "./run.mjs";
import { sceneContextEntry } from "../foundry-compat.mjs";

const ID = "kg-realms";

export function installChallenges({ party, sceneLevel, onChange }) {
  const runner = new ChallengeRun();
  const builder = new ChallengeBuilder({ runner, party });
  const allowed = (scene) => !!scene && ["site", "place"].includes(sceneLevel(scene));
  const fail = (err) => { console.error(`${ID} | skill challenge:`, err); ui.notifications.error(`KG Realms: ${err.message}`); };
  const open = (scene) => {
    if (!allowed(scene)) return ui.notifications.warn("KG Realms: skill challenges go on a Site or local map (a theater or battlemap scene), not the realm or regional map.");
    return builder.open(scene).catch(fail);
  };

  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM || !allowed(canvas?.scene)) return;
    const tokens = controls.tokens ?? (Array.isArray(controls) ? controls.find((c) => c.name === "token") : null);
    if (!tokens) return;
    const tool = { name: "kgRealmsChallenge", title: sceneRun(canvas.scene) ? "Skill challenge (running)" : "Skill challenge", icon: "fa-solid fa-dice-d20", button: true, order: 102, onChange: () => open(canvas.scene), onClick: () => open(canvas.scene) };
    if (Array.isArray(tokens.tools)) tokens.tools.push(tool); else tokens.tools.kgRealmsChallenge = tool;
  });

  const sceneFrom = (li) => { const el = li instanceof HTMLElement ? li : li?.[0]; return game.scenes.get(el?.dataset?.entryId ?? el?.dataset?.documentId); };
  for (const hook of ["getSceneContextOptions", "getSceneDirectoryEntryContext"]) Hooks.on(hook, (_app, options) => {
    if (!Array.isArray(options)) return;
    options.push(sceneContextEntry({ name: "Skill challenge", icon: '<i class="fa-solid fa-dice-d20"></i>', condition: (li) => game.user.isGM && allowed(sceneFrom(li)), callback: (li) => open(sceneFrom(li)) }));
  });

  Hooks.on("renderSceneConfig", (app, html) => {
    const scene = app.document ?? app.object, root = html instanceof HTMLElement ? html : html?.[0];
    if (!game.user.isGM || !root || !allowed(scene) || root.querySelector("[data-kgr-challenge-config]")) return;
    const target = root.querySelector('.tab[data-tab="basics"]') ?? root.querySelector("form") ?? root;
    const c = sceneChallenge(scene), field = document.createElement("fieldset");
    field.dataset.kgrChallengeConfig = "true";
    field.innerHTML = `<legend>KG Realms skill challenge</legend><div class="form-group"><label>${c ? foundry.utils.escapeHTML(c.name) : "None yet"}</label><div class="form-fields"><button type="button" data-kgr-open-challenge><i class="fa-solid fa-dice-d20"></i> ${c ? "Open the builder" : "Build one"}</button></div><p class="hint">A skill challenge on this scene: stages of skill checks, successes before failures, and its outcomes.</p></div>`;
    field.querySelector("button").addEventListener("click", (e) => { e.preventDefault(); open(scene); });
    target.append(field);
  });

  Hooks.on("canvasReady", () => runner.render());
  Hooks.on("updateScene", (scene, changes) => {
    if (!foundry.utils.hasProperty(changes, `flags.${ID}`) && !Object.keys(changes?.flags?.[ID] ?? {}).length) return;
    if (scene.id === canvas?.scene?.id) runner.render();
    if (builder.scene?.id === scene.id && builder.el) builder.render();
    if (game.user.isGM && scene.id === canvas?.scene?.id) { ui.controls?.render?.(); onChange?.(scene); }
  });
  Hooks.once("ready", () => {
    runner.render();
    const api = game.modules.get(ID)?.api;
    const challenges = { open: (scene = canvas.scene) => open(scene), run: (scene = canvas.scene) => sceneRun(scene), end: (scene = canvas.scene) => runner.end(scene) };
    if (api) api.challenges = challenges; else game.modules.get(ID).api = { challenges };
  });

  return {
    runner, builder,
    /** What the encounter box shows for a scene: { name, running }, or null when it has no challenge. */
    about(scene) {
      if (!allowed(scene)) return null;
      const c = sceneChallenge(scene), r = sceneRun(scene);
      return c || r ? { name: r?.name ?? c?.name ?? "Skill challenge", running: !!r && !r.result } : null;
    },
    /** From the encounter box: a running challenge's panel comes back up; otherwise the builder opens. */
    openFrom(scene) {
      const r = sceneRun(scene);
      if (r && scene.id === canvas?.scene?.id) return runner.show();
      return open(scene);
    },
    /** A socket message: true when it was a skill challenge's. */
    receive(m, userId) {
      if (typeof m?.type !== "string" || !m.type.startsWith("challenge-")) return false;
      runner.receive(m, userId);
      return true;
    }
  };
}
