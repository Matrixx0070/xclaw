# XClaw gateway image (P4.5)
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

ENV NODE_ENV=production
ENV XCLAW_SERVER_PORT=4243
EXPOSE 4243

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${XCLAW_SERVER_PORT}/ready" || exit 1

CMD ["node", "bin/xclaw.mjs", "gateway"]

# Optional MITM (uncomment to bake mitmproxy into the image):
# RUN pip install --no-cache-dir mitmproxy \
#  && ln -sf /usr/local/bin/mitmdump /usr/bin/mitmdump || true
