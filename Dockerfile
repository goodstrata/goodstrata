# GoodStrata — single self-host image: API + workers + built PWA.
# Runtime needs exactly two containers: this one and Postgres.

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
ENV NODE_ENV=production
COPY --from=build /app /app
ENV WEB_DIST=/app/apps/web/dist
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3000
# tsx runs the TS sources directly — internal packages ship raw TS by design.
CMD ["pnpm", "--filter", "@goodstrata/api", "start"]
