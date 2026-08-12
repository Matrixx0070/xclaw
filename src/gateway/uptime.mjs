/** Process start time for uptime metrics */
export const STARTED_AT = Date.now();

export function uptimeMs() {
  return Date.now() - STARTED_AT;
}

export function uptimeInfo() {
  const ms = uptimeMs();
  return {
    startedAt: new Date(STARTED_AT).toISOString(),
    uptimeMs: ms,
    uptimeSec: Math.floor(ms / 1000),
  };
}
