export function gmGame(extra = {}) {
  const user = { id: "gm", name: "Primary", isGM: true, active: true };
  const users = [user]; users.get = (id) => users.find((u) => u.id === id);
  globalThis.game = { user, users, settings: { get: () => "" }, time: { worldTime: 3600 }, ...extra };
  return game;
}

export function testScene(state, id = "realm") {
  const writes = [];
  const scene = { id, writes, grid: { size: 100 }, tokens: [], getFlag: () => state,
    update: async (patch) => {
      writes.push(patch);
      for (const [path, value] of Object.entries(patch)) {
        const keys = path.replace(/^flags\.kg-realms\.journey\.?/, "").split(".");
        let target = state;
        for (const k of keys.slice(0, -1)) target = target[k] ??= {};
        const last = keys.at(-1);
        if (last.startsWith("-=")) delete target[last.slice(2)]; else target[last] = value;
      }
    } };
  return scene;
}
