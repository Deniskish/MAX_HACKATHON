// All explicit AI actions share this counter, including panels and draft creation.
// Subscribers can cancel background HTTP work before the new fetch starts.
let active = 0;
const listeners = new Set<() => void>();
export const getAIActivity = () => active;
export const subscribeAIActivity = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function beginAIActivity() {
  active++;
  listeners.forEach(listener => listener());
  let ended = false;
  return () => {
    if (ended) return;
    ended = true; active--;
    listeners.forEach(listener => listener());
  };
}
