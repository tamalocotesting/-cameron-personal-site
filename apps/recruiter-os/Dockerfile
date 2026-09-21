# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# RecruiterOS application image.
#
# Multi-stage, non-root, standalone Next.js output. The worker runs from the
# same image with a different command, so the two processes can never drift
# apart in dependency or migration terms.
# ---------------------------------------------------------------------------
FROM node:22.20.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---- dependencies ---------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build ----------------------------------------------------------------
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build needs a syntactically valid URL for `prisma generate`; nothing is
# connected to and no data is read at build time.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV BETTER_AUTH_SECRET=build-time-placeholder-value-not-used-at-runtime
ENV BETTER_AUTH_URL=http://localhost:3000
ENV PUBLIC_APP_URL=http://localhost:3000
RUN pnpm exec prisma generate && pnpm exec next build

# ---- runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# A dedicated unprivileged user. Nothing in the image needs root.
RUN groupadd --system --gid 1001 recruiteros \
 && useradd --system --uid 1001 --gid recruiteros --home /app recruiteros

COPY --from=build --chown=recruiteros:recruiteros /app/.next/standalone ./
COPY --from=build --chown=recruiteros:recruiteros /app/.next/static ./.next/static
COPY --from=build --chown=recruiteros:recruiteros /app/public ./public

# The worker, the migrations and the CLI scripts need the source and the
# toolchain, so they travel with the image too.
COPY --from=build --chown=recruiteros:recruiteros /app/node_modules ./node_modules
COPY --from=build --chown=recruiteros:recruiteros /app/prisma ./prisma
COPY --from=build --chown=recruiteros:recruiteros /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=recruiteros:recruiteros /app/worker ./worker
COPY --from=build --chown=recruiteros:recruiteros /app/src ./src
COPY --from=build --chown=recruiteros:recruiteros /app/scripts ./scripts
COPY --from=build --chown=recruiteros:recruiteros /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=recruiteros:recruiteros /app/tsconfig.scripts.json ./tsconfig.scripts.json
COPY --from=build --chown=recruiteros:recruiteros /app/package.json ./package.json

USER recruiteros
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
