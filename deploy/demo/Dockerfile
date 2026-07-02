# Self-contained GoodStrata demo for Cloudflare Containers:
# Postgres 18 + the app in one image. State is ephemeral by design —
# every fresh instance boots, seeds "48 Rose St", and the agents go to work.

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

FROM postgres:18-alpine
RUN apk add --no-cache nodejs npm && npm install -g pnpm@9.15.2
WORKDIR /app
COPY --from=build /app /app

ENV POSTGRES_USER=goodstrata \
    POSTGRES_PASSWORD=goodstrata \
    POSTGRES_DB=goodstrata \
    PGDATA=/var/lib/postgresql/data \
    DATABASE_URL=postgres://goodstrata:goodstrata@127.0.0.1:5432/goodstrata \
    PORT=3000 \
    NODE_ENV=development \
    APP_URL=https://demo.goodstrata.com.au \
    BETTER_AUTH_SECRET=goodstrata-demo-sandbox-not-a-secret \
    AI_PROVIDER=mock \
    DEMO_MODE=1 \
    EMAIL_PROVIDER=console \
    WEB_DIST=/app/apps/web/dist \
    DATA_DIR=/data

COPY deploy/demo/start.sh /start.sh
RUN chmod +x /start.sh && mkdir -p /data

EXPOSE 3000
ENTRYPOINT []
CMD ["/bin/sh", "/start.sh"]
