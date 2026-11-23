/** Realms has one native Scene Controls group, with only the tools that apply here. */
export function sceneEditorTools(controls, { scene, isGM, map, canTravel, active, edit, travel, search, challenge }) {
  if (!scene) return;
  const tools = {};
  const add = (name, title, icon, onChange, toggle = false) => {
    tools[name] = { name, title, icon, order: Object.keys(tools).length, onChange,
      ...(toggle ? { toggle: true, active } : { button: true }) };
  };
  if (map && canTravel) add("travel", "Travel", "fa-solid fa-person-hiking", travel);
  if (map && isGM) add("edit", "Edit map (E)", "fa-solid fa-pen-ruler", (_event, on) => edit(on), true);
  if (map) add("search", "Search map (Ctrl+F)", "fa-solid fa-magnifying-glass-location", search);
  if (isGM && challenge) add("challenge", "Skill challenge", "fa-solid fa-dice-d20", challenge);
  if (!Object.keys(tools).length) return;
  // V13 calls the active tool when switching groups. Supply a neutral tool without rendering a button.
  Object.defineProperty(tools, "idle", { value: { name: "idle" } });
  controls.kgRealms = { name: "kgRealms", title: "Realms", icon: "fa-solid fa-map", order: 100,
    activeTool: "idle", tools };
}
