/**
 * Swarm Logger Middleware
 * Request/response logging for swarm endpoints
 */
export function swarmLogger(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[swarm-api] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });

  next();
}
