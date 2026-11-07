/**
 * One setting's writes, one at a time: each task starts after the previous one has finished, so it
 * reads the value the previous write left. The caller gets its own task's result or error; a failed
 * task does not stop the ones after it.
 */
export function writeQueue() {
  let last = Promise.resolve();
  return (task) => {
    const run = last.catch(() => {}).then(task);
    last = run;
    return run;
  };
}
