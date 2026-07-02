#!/bin/sh
set -e

echo "[demo] starting postgres…"
# The official image entrypoint handles initdb on first boot.
docker-entrypoint.sh postgres &

until pg_isready -q -h 127.0.0.1 -U "$POSTGRES_USER"; do
  sleep 1
done
echo "[demo] postgres ready — seeding 48 Rose St (idempotent)…"

cd /app
pnpm --filter @goodstrata/api seed:demo || echo "[demo] seed skipped/failed (continuing)"

echo "[demo] starting goodstrata…"
exec pnpm --filter @goodstrata/api start
