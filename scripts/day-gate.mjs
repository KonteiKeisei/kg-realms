/** True the first time it is called, and after that only when the game date (year, month, day) has changed. */
export function dayGate() {
  let last;
  return (c) => {
    const key = `${c?.year}/${c?.month}/${c?.dayOfMonth}`;
    if (key === last) return false;
    last = key;
    return true;
  };
}
