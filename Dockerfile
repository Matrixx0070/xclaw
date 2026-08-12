# XClaw gateway image (lab/full toolchain)
# Prefer deploy/Dockerfile for production-slim; this image includes
# office/OCR helpers for computer tools.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg imagemagick libreoffice-writer libreoffice-calc libreoffice-impress \
    tesseract-ocr curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY ui ./ui
COPY skills ./skills
COPY scripts ./scripts
COPY docs ./docs
COPY eval ./eval

ENV NODE_ENV=production \
    XCLAW_GATEWAY_HOST=0.0.0.0 \
    XCLAW_GATEWAY_PORT=18790 \
    XCLAW_COMPUTER_HOST=0.0.0.0 \
    XCLAW_COMPUTER_PORT=4243 \
    XCLAW_SERVER_PORT=4243

EXPOSE 18790 4243

# Product surface is the gateway (WebChat + API), not only the computer sidecar.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:18790/ready" || exit 1

CMD ["node", "bin/xclaw.mjs", "gateway"]

# Optional MITM (uncomment to bake mitmproxy into the image):
# RUN pip install --no-cache-dir mitmproxy \
#  && ln -sf /usr/local/bin/mitmdump /usr/bin/mitmdump || true
