/**
 * Remember last POST /stop drain for doctor.
 */
let last = null;

export function recordLastDrain(drain, extra = {}) {
  last = { ...drain, at: extra.at || new Date().toISOString(), ...extra };
  return last;
}

export function getLastDrain() {
  return last;
}

export default { recordLastDrain, getLastDrain };
