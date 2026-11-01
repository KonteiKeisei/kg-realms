import { isPrimaryGM } from "./authority.mjs";

const MODULE_ID = "kg-realms";

/** The night look for settlement scenes: Foundry's Dark Ambience. */
export const DARK_AMBIENCE = { luminosity: 0.45, saturation: -0.5, shadows: 0, hue: 0.5, intensity: 0.5 };
/** The night look for realm and region scenes. */
export const REALM_DARK_AMBIENCE = { luminosity: 0, saturation: -0.85, shadows: 0.35, hue: 0.5, intensity: 0.85 };

// Raised when an ambience above changes, so scenes already set are set again once.
export const AMBIENCE_REVISION = 1;
export const REALM_AMBIENCE_REVISION = 2;

/** Settlements with a night look of their own, by local map preset id. */
const SETTLEMENT_AMBIENCE = {
  luskan: { dark: { luminosity: -0.15, saturation: -0.7, shadows: 0.6, hue: 0.6, intensity: 0.6 }, revision: 2 },
  neverwinter: { dark: { luminosity: 0.05, saturation: -0.35, shadows: 0, hue: 0.56, intensity: 0.65 }, revision: 2 },
  "waterdeep-v2": { dark: { luminosity: 0.35, saturation: -0.8, shadows: 0, hue: 0.6, intensity: 0.7 }, revision: 2 }
};
/** A settlement scene's Dark Ambience and its revision. */
export const settlementAmbience = (presetId) => SETTLEMENT_AMBIENCE[presetId] ?? { dark: DARK_AMBIENCE, revision: AMBIENCE_REVISION };

// The exported Helm's Hold, Luskan and Neverwinter scenes each held one light with a radius of
// 100,000, lighting the whole scene from one corner. It is no longer in the effects data, and
// these remove it from scenes that already have it.
export const STRAY_LIGHT_IDS = new Set(["17DLLGiBO4sBF7HY", "mzGu5nKHVyVYBljF", "4u22VWjY7GsxrvKS"]);

/**
 * Once per scene: the Dark Ambience above on KG Realms scenes, and the stray light removed.
 * A GM who changes a scene's ambience afterwards keeps the change.
 */
export async function applySceneAmbience(isRealm, isLocal) {
  if (!isPrimaryGM()) return;
  let changed = 0;
  for (const scene of game.scenes) {
    const realm = isRealm(scene);
    if (!realm && !isLocal(scene)) continue;
    const { dark, revision } = realm ? { dark: REALM_DARK_AMBIENCE, revision: REALM_AMBIENCE_REVISION }
      : settlementAmbience(scene.getFlag(MODULE_ID, "localMap")?.presetId);
    if ((scene.getFlag(MODULE_ID, "darkAmbience") ?? 0) < revision) {
      await scene.update({ "environment.dark": dark, [`flags.${MODULE_ID}.darkAmbience`]: revision });
      changed++;
    }
    const stray = Array.from(scene.lights ?? [], (l) => l.id).filter((id) => STRAY_LIGHT_IDS.has(id));
    if (stray.length) await scene.deleteEmbeddedDocuments("AmbientLight", stray);
  }
  if (changed) ui.notifications.info(`KG Realms: Dark Ambience set on ${changed} scene(s).`);
}
