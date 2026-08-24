/**
 * Swarm Auth Middleware
 * API key validation with tier-based permissions
 */
export function swarmAuth(req, res, next) {
  const swarmKey = req.headers["x-swarm-key"] || req.headers["authorization"]?.replace("Bearer ", "");

  if (!swarmKey) {
    return next(); // Let XClaw auth handle it
  }

  const validKeys = process.env.SWARM_API_KEYS?.split(",") || [];
  if (!validKeys.includes(swarmKey)) {
    return res.status(401).json({ error: "Invalid swarm API key" });
  }

  req.swarm = {
    key: swarmKey,
    tier: "standard",
    authenticated: true,
  };

  next();
}
