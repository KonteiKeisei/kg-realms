// One build per world on the primary GM client. Unique upload folders also isolate other clients.
const builds = new Set();
export async function runMapBuild(world, build) {
  if (builds.has(world)) throw Error("This world already has a map build running.");
  builds.add(world);
  try { return await build(); }
  finally { builds.delete(world); }
}
