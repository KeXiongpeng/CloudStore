#!/usr/bin/env bash
set -euo pipefail

# D7 production deployment. Run only after an explicit production approval.
# This script never stores the SSH password; OpenSSH will prompt interactively.

readonly COMMIT='455e814'
readonly HOST='root@120.77.222.102'
readonly REMOTE_DIR='/opt/cloud-storage'
readonly SERVER_TAR='release/server-v11.tar'
readonly SERVER_SHA256='7ad10d7acbb559461647a9add744c1d7f499a40e314ce0e4636a51536c5fb471'
readonly CLIENT_IMAGE='crpi-7znqdwo2lmmjl5kg.cn-shenzhen.personal.cr.aliyuncs.com/cloud-storage/client:v8'
readonly SERVER_IMAGE='crpi-7znqdwo2lmmjl5kg.cn-shenzhen.personal.cr.aliyuncs.com/cloud-storage/server:v11'
readonly COMPOSE='docker compose -f docker-compose.prod.yml'

log() { printf '\n==> %s\n' "$*"; }

remote() { ssh -o StrictHostKeyChecking=accept-new "$HOST" "$@"; }

log 'Verifying local release artifact'
[[ -f "$SERVER_TAR" ]] || { echo "missing $SERVER_TAR" >&2; exit 1; }
echo "$SERVER_SHA256  $SERVER_TAR" | sha256sum -c -

log 'Uploading server image fallback'
ssh -o StrictHostKeyChecking=accept-new "$HOST" "mkdir -p '$REMOTE_DIR/releases'"
scp -o StrictHostKeyChecking=accept-new "$SERVER_TAR" "$HOST:$REMOTE_DIR/releases/server-v11.tar"

log 'Updating repository and checking release commit'
remote "cd '$REMOTE_DIR' && git fetch origin feat/d7-contextual-rag-ux && git checkout '$COMMIT'"

log 'Backing up production PostgreSQL'
remote "cd '$REMOTE_DIR' && set -a && source .env && set +a && mkdir -p backups && $COMPOSE exec -T postgres pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" > backups/postgres-\${POSTGRES_DB}-pre-d7-\$(date +%Y%m%d%H%M%S).sql && ls -lh backups/postgres-*-pre-d7-*.sql | tail -1"

log 'Loading server:v11 and pulling client:v8'
remote "cd '$REMOTE_DIR' && docker load -i releases/server-v11.tar && docker pull '$CLIENT_IMAGE' && docker image inspect '$SERVER_IMAGE' '$CLIENT_IMAGE'"

log 'Validating compose configuration'
remote "cd '$REMOTE_DIR' && $COMPOSE config --quiet"

log 'Stopping application containers before migration'
remote "cd '$REMOTE_DIR' && $COMPOSE stop nextjs server-worker nestjs"

log 'Starting database dependencies and applying migration'
remote "cd '$REMOTE_DIR' && $COMPOSE up -d postgres redis && $COMPOSE run --rm nestjs npx prisma migrate deploy"

log 'Starting D7 application containers'
remote "cd '$REMOTE_DIR' && $COMPOSE up -d nestjs server-worker nextjs"

log 'Checking migration status and application health'
remote "cd '$REMOTE_DIR' && $COMPOSE run --rm nestjs npx prisma migrate status && sleep 5 && docker exec cloud-storage-nestjs-1 wget -qO- http://127.0.0.1:3000/api/auth/providers"

log 'Deployment commands completed; now verify https://cloudstore.kxpwty.cn from local machine'
