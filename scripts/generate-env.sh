#!/usr/bin/env bash
#
# Genera el .env de produccion con secretos aleatorios.
#
# Uso:
#   ./scripts/generate-env.sh shalom.tudominio.com
#   ./scripts/generate-env.sh shalom.tudominio.com --force
#
set -euo pipefail

DOMAIN="${1:-}"
FORCE="${2:-}"

if [[ -z "$DOMAIN" ]]; then
  echo "Uso: $0 <subdominio> [--force]"
  echo "Ej:  $0 shalom.tudominio.com"
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ -f "$ENV_FILE" && "$FORCE" != "--force" ]]; then
  echo "Ya existe $ENV_FILE. Usa --force para sobrescribirlo."
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "Falta openssl. Instala con: apt-get install -y openssl"
  exit 1
fi

# 32 bytes en base64 (obligatorio para AES-256-GCM)
SECRETS_ENCRYPTION_KEY="$(openssl rand -base64 32)"
# 64 caracteres hex
API_KEY_PEPPER="$(openssl rand -hex 32)"
# 64 caracteres hex
ADMIN_TOKEN="$(openssl rand -hex 32)"
# hex: seguro para meter en una URL
POSTGRES_PASSWORD="$(openssl rand -hex 24)"

umask 077
cat > "$ENV_FILE" <<EOF
# Generado por scripts/generate-env.sh el $(date -u +%Y-%m-%dT%H:%M:%SZ)
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=4100

POSTGRES_USER=nuvex_shalom
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=nuvex_shalom
POSTGRES_PUBLISHED_PORT=5433

DATABASE_URL=postgresql://nuvex_shalom:$POSTGRES_PASSWORD@localhost:5433/nuvex_shalom?schema=public

SECRETS_ENCRYPTION_KEY=$SECRETS_ENCRYPTION_KEY
API_KEY_PEPPER=$API_KEY_PEPPER
ADMIN_TOKEN=$ADMIN_TOKEN

CORS_ORIGINS=https://$DOMAIN
TRUST_PROXY_HOPS=1
RATE_LIMIT_PER_MINUTE=120
WEBHOOK_TIMEOUT_MS=10000

SHALOM_BASE_URL=https://pro.shalom.pe
SHALOM_TRACKING_URL=https://shalom.com.pe/rastrea/
SHALOM_HEADLESS=true
SHALOM_BROWSER_CHANNEL=chromium
SHALOM_MAX_CONTEXTS=2
SHALOM_ACQUIRE_TIMEOUT_MS=60000
SHALOM_LOGIN_TIMEOUT_MS=45000
SHALOM_RELOGIN_COOLDOWN_SECONDS=30

SHALOM_TRACKING_ENABLED=false
SHALOM_TRACKING_INTERVAL_MINUTES=15
SHALOM_TRACKING_BATCH=20

IMAGE_TAG=latest
API_PUBLISHED_PORT=4100
EOF

chmod 600 "$ENV_FILE"

echo "=============================================================="
echo " .env generado: $ENV_FILE"
echo "=============================================================="
echo " Dominio (CORS): https://$DOMAIN"
echo " Admin token   : $ADMIN_TOKEN"
echo "--------------------------------------------------------------"
echo " Secretos (solo se muestran enmascarados):"
echo "   SECRETS_ENCRYPTION_KEY = $(echo "$SECRETS_ENCRYPTION_KEY" | cut -c1-6)...  (base64 32B)"
echo "   API_KEY_PEPPER         = $(echo "$API_KEY_PEPPER" | cut -c1-6)...  (hex 64)"
echo "   POSTGRES_PASSWORD      = ${POSTGRES_PASSWORD:0:4}... (hex 48)"
echo "=============================================================="
echo ""
echo "Siguientes pasos:"
echo "  1) docker compose up -d --build"
echo "  2) docker compose exec api npx prisma migrate deploy"
echo "  3) curl -X POST http://127.0.0.1:4100/v1/admin/tenants \\"
echo "       -H \"X-Admin-Token: \$ADMIN_TOKEN\" \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"code\":\"nobitex\",\"name\":\"Nobitex\",\"username\":\"CORREO\",\"password\":\"CLAVE\"}'"
echo ""
echo "Guarda el ADMIN_TOKEN en tu gestor de secretos: sin el no puedes administrar la API."
