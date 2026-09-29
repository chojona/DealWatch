#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Dealwatch.
# Safe to run repeatedly. Does not start the dev server.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cat > .env << 'EOF'
DATABASE_URL="file:./dev.db"
DEALWATCH_AI_PROVIDER="openai"
RUN_DEALWATCH_INTEGRATION_TESTS="0"
EOF
elif ! grep -q '^DATABASE_URL=' .env; then
  printf '\nDATABASE_URL="file:./dev.db"\n' >> .env
fi

npm ci
npx prisma generate
npm run db:push

deal_count="$(sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Deal;")"
if [ "$deal_count" = "0" ]; then
  npm run db:seed
fi
