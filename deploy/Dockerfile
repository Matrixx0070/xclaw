# XClaw 1.0 — production-slim image
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY ui ./ui
COPY skills ./skills
COPY eval ./eval
COPY docs ./docs
COPY INSTALL.md CHANGELOG.md README.md XCLAW.md ./

# A container binds inside its own netns, so a published port needs 0.0.0.0.
# That makes the bind guard load-bearing here: run with XCLAW_GATEWAY_TOKEN set
# (or XCLAW_GATEWAY_ALLOW_OPEN=1 on a trusted, unpublished network) or the
# gateway refuses to start.
ENV NODE_ENV=production \
    XCLAW_HOME=/data \
    HOME=/data \
    XCLAW_GATEWAY_HOST=0.0.0.0 \
    XCLAW_GATEWAY_PORT=18790 \
    XCLAW_COMPUTER_HOST=0.0.0.0 \
    XCLAW_COMPUTER_PORT=4243

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 18790 4243

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:18790/ready || exit 1

CMD ["node", "bin/xclaw.mjs", "gateway"]
