FROM node:24.22.1-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY web ./web
COPY skills ./skills
RUN mkdir -p /data/workspace && chown -R node:node /data
FROM base AS controller
RUN chown root:root /data
CMD ["node","/app/src/server.ts"]
FROM base AS worker
USER node
WORKDIR /data/workspace
CMD ["node","/app/src/worker.ts"]
