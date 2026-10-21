#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f apps/api/.env ]]; then
  cp .env.example apps/api/.env
fi

if [[ ! -f apps/mobile/.env ]]; then
  printf '%s\n' 'EXPO_PUBLIC_API_URL=http://localhost:3000' > apps/mobile/.env
fi

npm run lint
npm run format:check
npm run typecheck
npm test
npm run db:up
npm run db:migrate
npm run test:e2e
npm run build

echo "Validation finished."
