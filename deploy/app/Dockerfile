# Production GoodStrata app for Cloudflare Containers: the Node API serves the
# built web PWA (WEB_DIST) same-origin and connects OUT to managed Postgres
# (Supabase). No database in the image, no seed — real, persistent tenants.
# All runtime config + secrets arrive from the Worker (deploy/app/worker.ts).

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/events/package.json packages/events/
COPY packages/core/package.json packages/core/
COPY packages/agents/package.json packages/agents/
COPY packages/integrations/package.json packages/integrations/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @goodstrata/web build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app

# Invariant runtime config only; everything else (DATABASE_URL, secret, provider
# selection) is injected by the Worker so config changes don't rebuild the image.
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/apps/web/dist \
    DATA_DIR=/data

RUN mkdir -p /data
EXPOSE 3000
# Migrations run on boot (runMigrations against Supabase); then serve.
CMD ["pnpm", "--filter", "@goodstrata/api", "start"]
