const groups = [
  ["Interface (this computer)", ["windowTheme", "windowOpacity", "windowBlur", "markerScale", "labelScale", "hoverDelayMs", "cityCarriageVolume"]],
  ["Graphics and files (this computer)", ["highDpi", "namesAbove", "realmTerrainBudget", "localMapBudget", "mapAssets"]],
  ["Travel and camp (world defaults)", ["travelRules", "priceScale", "showPerceptionDC", "advancedWatchesMenu", "watchesAtSea", "downtimeReminder", "harvestHumanoidMeat", "harvestSpoilage", "harvestRulesMenu"]],
  ["Maps and settlements (world defaults)", ["look", "dayStart", "nightStart", "seasonalSnow", "localMapWaterRegions", "defaultIconPack", "cityWalkMph", "cityCarriageMph", "cityTransitRate", "cityCarriageSound"]],
  ["Administration (world defaults)", ["primaryGM", "partyActor", "partyAppearance", "integrationSetupMenu", "maxSide"]]
];

/** Reuse Foundry's fields, form submission and permission checks. */
export function groupRealmSettings(root) {
  if (!root?.querySelector || root.querySelector(".kgr-settings-group")) return;
  const findRow = (key) => root.querySelector(`[name="kg-realms.${key}"], [data-key="kg-realms.${key}"]`)?.closest(".form-group");
  const sections = groups.map(([label, keys]) => [label, [...new Set(keys.map(findRow).filter(Boolean))]]);
  const start = sections.flatMap(([, rows]) => rows)
    .sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1)[0];
  if (!start) return;
  const parent = start.parentElement, marker = start.ownerDocument.createComment("KG Realms settings");
  start.before(marker);
  for (const [label, rows] of sections) {
    const available = rows.filter(row => row.parentElement === parent);
    if (!available.length) continue;
    const group = start.ownerDocument.createElement("fieldset"), heading = start.ownerDocument.createElement("legend");
    group.className = "kgr-settings-group";
    heading.textContent = label;
    group.append(heading, ...available);
    marker.before(group);
  }
  marker.remove();
}
