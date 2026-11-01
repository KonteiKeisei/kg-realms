import {isPrimaryGM} from './authority.mjs';
import { worldPath, defaultWorldId } from "./worlds.mjs";

const MODULE = 'kg-realms';
const fxReady = () => game.modules.get('fxmaster')?.active && game.modules.get('fxmaster-plus')?.active;
const wantsWater = () => game.settings.get(MODULE, 'localMapWaterRegions') !== false;
const waterSettingDisabled = new WeakMap();

export function waterRegionSettingUI(root) {
  const input = root?.querySelector?.('input[name="kg-realms.localMapWaterRegions"]');
  if (!input) return;
  const available = !!fxReady(), row = input.closest('.form-group');
  if (!waterSettingDisabled.has(input)) waterSettingDisabled.set(input, input.disabled);
  input.disabled = !available || waterSettingDisabled.get(input);
  row?.classList.toggle('kgr-water-regions-unavailable', !available);
  const hint = row?.querySelector('.hint');
  hint?.classList.add('kgr-water-regions-warning');
  let requirement = row?.querySelector('.kgr-water-regions-requirement');
  if (!available && row && !requirement) {
    requirement = document.createElement('p');
    requirement.className = 'hint kgr-water-regions-requirement';
    requirement.textContent = 'Requires active FXMaster and FXMaster+ modules.';
    row.append(requirement);
  }
  if (available) requirement?.remove();
}
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
};
const sourceOf = doc => doc.toObject?.() ?? doc;
const lightSignature = doc => {const d=sourceOf(doc);return JSON.stringify(stable([d.x,d.y,d.elevation??0,d.rotation??0,d.walls??true,d.vision??false,d.hidden??false,d.config]));};
const regionSignature = doc => {const d=sourceOf(doc);return JSON.stringify(stable([d.shapes,d.elevation,d.behaviors?.map(b=>({type:b.type,system:b.system,disabled:b.disabled??false}))]));};

/** One-time world enable. Players retain their own FXMaster rendering preference. */
export async function enableLocalMapFx() {
  if (!isPrimaryGM() || !fxReady() || !wantsWater() || game.settings.get(MODULE, 'localMapFxEnabled')) return;
  if (!game.settings.settings.has('fxmaster.disableAll')) return;
  if (game.settings.get('fxmaster', 'disableAll')) {
    await game.settings.set('fxmaster', 'disableAll', false);
    ui.notifications.info('KG Realms: FXMaster effects are enabled for the world. Reload clients if effects were previously disabled.');
  }
  await game.settings.set(MODULE, 'localMapFxEnabled', true);
}

export function effectGeometryMatches(scene, source) {
  return scene.width === source.width && scene.height === source.height && (scene.padding ?? 0) === source.padding && scene.grid?.size === source.gridSize
    && (source.gridDistance === undefined || scene.grid?.distance === source.gridDistance)
    && (source.gridUnits === undefined || scene.grid?.units === source.gridUnits);
}

// Stable source IDs prevent duplicate lights or masks in worlds imported from these exports.
// Completion flags ensure that a later GM deletion is respected.
export class LocalMapEffects {
  jobs = new Map();
  cache = new Map();
  pending = new Set();
  async apply(scene, entry, world = defaultWorldId()) {
    if (!entry || !isPrimaryGM()) return;
    const key = `${scene.id}:${world}:${entry.file}`;
    if (this.jobs.has(key)) {this.pending.add(key); return this.jobs.get(key);}
    const job = (async()=>{
      do {this.pending.delete(key); await this.#apply(scene, entry, world);} while(this.pending.has(key));
    })().finally(() => {this.jobs.delete(key);this.pending.delete(key);});
    this.jobs.set(key, job);
    return job;
  }
  async #apply(scene, entry, world) {
    const revision = entry.revision ?? 1, have = scene.getFlag(MODULE, 'localEffects') ?? {};
    const regionsReady = fxReady(), water = wantsWater();
    if ((have.lights ?? 0) >= revision && (!regionsReady || ((!water || (have.regions ?? 0) >= revision) && have.waterEnabled === water))) return;
    const path = worldPath(world, `local/${entry.file}`);
    if (!this.cache.has(path)) this.cache.set(path, (async()=>{
      const response = await fetch(foundry.utils.getRoute(path));
      if (!response.ok) throw Error(`Local map effects: HTTP ${response.status}`);
      const data = await response.json();
      if (data.schema !== 1 || !data.source || !Array.isArray(data.lights) || !Array.isArray(data.regions)) throw Error('Invalid local map effects');
      return data;
    })().catch(error => {this.cache.delete(path); throw error;}));
    const data = await this.cache.get(path);
    if (!isPrimaryGM()) return;
    if (!effectGeometryMatches(scene, data.source)) {
      console.warn(`kg-realms | ${scene.name}: lighting and FX defaults skipped because the scene was resized or its grid changed.`);
      return;
    }
    const progress = {...have};
    if ((have.lights ?? 0) < revision) {
      const ids = new Set(Array.from(scene.lights ?? [], doc => doc.id));
      const seen = new Set(have.seenLights ?? []);
      const existing = new Set(Array.from(scene.lights ?? [], lightSignature));
      const missing = data.lights.filter(light => !seen.has(light._id) && !ids.has(light._id) && !existing.has(lightSignature(light)));
      if (missing.length) await scene.createEmbeddedDocuments('AmbientLight', structuredClone(missing), {keepId:true, keepEmbeddedIds:true});
      progress.lights = revision;
      progress.seenLights = [...new Set([...seen, ...data.lights.map(light=>light._id)])];
    }
    if (!isPrimaryGM()) return;
    if (regionsReady && water && (have.regions ?? 0) < revision) {
      const models = globalThis.CONFIG?.RegionBehavior?.dataModels ?? {};
      if (data.regions.some(region => region.behaviors.some(behavior => !models[behavior.type]))) {
        console.warn('kg-realms | FXMaster region behavior support is unavailable. Enable compatible FXMaster and FXMaster+ versions, then reload.');
      } else {
        const ids = new Set(Array.from(scene.regions ?? [], doc => doc.id));
        const seen = new Set(have.seenRegions ?? []);
        const existing = new Set(Array.from(scene.regions ?? [], regionSignature));
        const missing = data.regions.filter(region => !seen.has(region._id) && !ids.has(region._id) && !existing.has(regionSignature(region)));
        if (missing.length) await scene.createEmbeddedDocuments('Region', structuredClone(missing), {keepId:true, keepEmbeddedIds:true});
        progress.regions = revision;
        progress.seenRegions = [...new Set([...seen, ...data.regions.map(region=>region._id)])];
      }
    }
    if (regionsReady) {
      const sourceIds = new Set(data.regions.map(r=>r._id));
      const signatures = new Set(data.regions.map(regionSignature));
      const managed = new Set(progress.waterRegionIds ?? []);
      for (const region of scene.regions ?? []) if(sourceIds.has(region.id) || signatures.has(regionSignature(region))) managed.add(region.id);
      progress.waterRegionIds = [...managed];
      if (await this.#water(scene, progress, water) === false) return;
    }
    if (isPrimaryGM() && JSON.stringify(progress) !== JSON.stringify(have)) await scene.setFlag(MODULE, 'localEffects', progress);
  }

  async #water(scene, progress, enabled) {
    const managed = new Set(progress.waterRegionIds ?? []), suspended = {...progress.waterSuspended}, tasks = [];
    for (const region of scene.regions ?? []) {
      if (!managed.has(region.id)) continue;
      const updates = [];
      for (const behavior of region.behaviors ?? []) {
        if (behavior.type !== 'fxmaster.filterEffectsRegion' || !behavior.system?.water_enabled) continue;
        const key = `${region.id}:${behavior.id ?? behavior._id}`;
        if (!enabled) {
          if (!(key in suspended)) suspended[key] = !!behavior.disabled;
          if (!behavior.disabled) updates.push({_id:behavior.id ?? behavior._id, disabled:true});
        } else if (suspended[key] === false && behavior.disabled) updates.push({_id:behavior.id ?? behavior._id, disabled:false});
      }
      if (updates.length) tasks.push({region, updates});
    }
    // Save the previous behavior states before editing, so a GM handover can resume safely.
    if (!enabled && JSON.stringify(suspended) !== JSON.stringify(progress.waterSuspended ?? {})) {
      progress.waterSuspended = suspended;
      if (!isPrimaryGM()) return false;
      await scene.setFlag(MODULE, 'localEffects', {...progress});
    }
    for (const {region, updates} of tasks) {
      if (!isPrimaryGM()) return false;
      await region.updateEmbeddedDocuments('RegionBehavior', updates);
    }
    progress.waterEnabled = enabled;
    if (enabled) progress.waterSuspended = {};
    return true;
  }
}
