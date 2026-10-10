# syntax=docker/dockerfile:1.7
#
# Targets:
#   runtime (default) - minimal production API image (no dev dependencies, non-root)
#   migrate           - one-off job image for `prisma migrate deploy` (includes the Prisma CLI)
#
# glibc-based images are used on purpose: sharp and argon2 ship prebuilt glibc binaries.

ARG NODE_VERSION=22-bookworm-slim

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate \
  && npm run build \
  && npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
USER node
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  PORT=3000 \
  LOCAL_STORAGE_PATH=/app/storage

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

RUN mkdir -p /app/storage && chown node:node /app/storage
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Node is PID 1 here; run with `--init` (compose: `init: true`) so signals are forwarded and
# zombies reaped. SIGTERM triggers Nest shutdown hooks (analytics flush, DB disconnect).
CMD ["node", "dist/src/main.js"]
