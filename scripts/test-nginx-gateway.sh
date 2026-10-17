#!/usr/bin/env bash
# Prueba de nginx-gateway.conf (#302): qué IP de cliente ve el backend por
# cada listener del gateway.
#
# Levanta en una red de Docker aislada:
#   - el gateway real (nginx:alpine + nginx-gateway.conf), publicando SOLO el
#     80 en 127.0.0.1, como el compose publica 8080:80 (ruta Tailscale Funnel);
#   - un backend de eco con el Express del repo y trust proxy = 1 (igual que
#     src/index.js), con los alias app/staff/superadmin, que devuelve req.ip;
#   - un contenedor "cloudflared" de mentira en la misma red, que le pega al 81.
#
# Necesita Docker y node_modules instalado (npm ci). Uso:
#   bash scripts/test-nginx-gateway.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
NGINX_IMAGE=nginx:alpine
NODE_IMAGE=node:20-alpine
ID="gwtest-$$"
NET="$ID-net"
HOST_PORT="${GATEWAY_TEST_PORT:-18080}"
CF_IP=203.0.113.7   # TEST-NET-3: IP "real" que mandaría Cloudflare
FAKE_IP=198.51.100.9 # TEST-NET-2: IP que inventa un atacante

fallos=0
ok() { echo "  ok   $1"; }
mal() { echo "  MAL  $1"; fallos=$((fallos + 1)); }
esperar_igual() { # descripción, obtenido, esperado
  if [ "$2" = "$3" ]; then ok "$1 ($2)"; else mal "$1: obtuve '$2', esperaba '$3'"; fi
}
esperar_distinto() { # descripción, obtenido, no-esperado
  if [ -n "$2" ] && [ "$2" != "$3" ]; then ok "$1 ($2)"; else mal "$1: obtuve '$2'"; fi
}

limpiar() {
  docker rm -f "$ID-gateway" "$ID-eco" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap limpiar EXIT

docker network create "$NET" >/dev/null

# Backend de eco: mismo Express y trust proxy que la app, en 3001 (app) y 80
# (staff/superadmin).
docker run -d --name "$ID-eco" --network "$NET" \
  --network-alias app --network-alias staff --network-alias superadmin \
  -v "$ROOT/node_modules:/eco/node_modules:ro" -w /eco \
  "$NODE_IMAGE" node --input-type=module -e "
    import express from 'express';
    const app = express();
    app.set('trust proxy', 1);
    app.use((req, res) => res.json({
      ip: req.ip,
      xff: req.headers['x-forwarded-for'] ?? null,
      xRealIp: req.headers['x-real-ip'] ?? null,
    }));
    app.listen(3001);
    app.listen(80);
  " >/dev/null

docker run -d --name "$ID-gateway" --network "$NET" \
  -p "127.0.0.1:$HOST_PORT:80" \
  -v "$ROOT/nginx-gateway.conf:/etc/nginx/conf.d/default.conf:ro" \
  "$NGINX_IMAGE" >/dev/null

echo "nginx -t:"
docker exec "$ID-gateway" nginx -t

# Espera a que el gateway y el eco respondan.
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$HOST_PORT/" >/dev/null 2>&1 && break
  sleep 1
done

# Listener 80, desde el host vía el puerto publicado (como el Funnel).
via_funnel() { curl -sS "$@"; }
# Listener 81, desde otro contenedor de la red (como cloudflared).
via_tunel() {
  docker run --rm --network "$NET" "$NGINX_IMAGE" curl -sS "$@"
}
campo() { node -e "const j = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(j['$1'] ?? '')"; }

GW_IP=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").Gateway}}" "$ID-gateway")
GATEWAY_URL_81="http://$ID-gateway:81"

echo
echo "Listener 81 (túnel de Cloudflare):"
r=$(via_tunel -H "CF-Connecting-IP: $CF_IP" -H "X-Forwarded-For: $FAKE_IP" "$GATEWAY_URL_81/api/ping")
esperar_igual "req.ip = CF-Connecting-IP" "$(campo ip <<<"$r")" "$CF_IP"
esperar_igual "X-Forwarded-For reemplazado (ignora el del cliente)" "$(campo xff <<<"$r")" "$CF_IP"
esperar_igual "X-Real-IP = CF-Connecting-IP" "$(campo xRealIp <<<"$r")" "$CF_IP"

for p in /staff/ /admin/; do
  r=$(via_tunel -H "CF-Connecting-IP: $CF_IP" "$GATEWAY_URL_81$p")
  esperar_igual "$p también recibe la IP de Cloudflare" "$(campo ip <<<"$r")" "$CF_IP"
done

r=$(via_tunel "$GATEWAY_URL_81/api/ping")
ip_sin_header=$(campo ip <<<"$r")
esperar_distinto "sin CF-Connecting-IP cae a \$remote_addr (no vacío)" "$ip_sin_header" ""
esperar_igual "sin CF-Connecting-IP, X-Real-IP = req.ip" "$(campo xRealIp <<<"$r")" "$ip_sin_header"

echo
echo "Listener 80 (Tailscale Funnel → localhost:8080), igual que antes de #302:"
r=$(via_funnel -H "CF-Connecting-IP: $CF_IP" "http://127.0.0.1:$HOST_PORT/api/ping")
esperar_distinto "ignora CF-Connecting-IP" "$(campo ip <<<"$r")" "$CF_IP"
esperar_igual "req.ip = gateway de la red de Docker" "$(campo ip <<<"$r")" "$GW_IP"
esperar_igual "no manda X-Real-IP" "$(campo xRealIp <<<"$r")" ""

r=$(via_funnel -H "X-Forwarded-For: $FAKE_IP" "http://127.0.0.1:$HOST_PORT/api/ping")
esperar_igual "agrega \$remote_addr al X-Forwarded-For entrante" "$(campo xff <<<"$r")" "$FAKE_IP, $GW_IP"
esperar_igual "un X-Forwarded-For inventado no cambia req.ip" "$(campo ip <<<"$r")" "$GW_IP"

echo
echo "Límite de tamaño (client_max_body_size 25m) en los dos listeners:"
esperar_igual "80: 30 MB → 413" \
  "$(head -c 31457280 /dev/zero | curl -s -o /dev/null -w '%{http_code}' --data-binary @- "http://127.0.0.1:$HOST_PORT/api/fotos")" 413
esperar_igual "81: 30 MB → 413" \
  "$(docker run --rm -i --network "$NET" "$NGINX_IMAGE" sh -c "head -c 31457280 /dev/zero | curl -s -o /dev/null -w '%{http_code}' --data-binary @- $GATEWAY_URL_81/api/fotos")" 413
esperar_igual "81: 1 MB → llega al backend" \
  "$(docker run --rm -i --network "$NET" "$NGINX_IMAGE" sh -c "head -c 1048576 /dev/zero | curl -s -o /dev/null -w '%{http_code}' --data-binary @- $GATEWAY_URL_81/api/fotos")" 200

echo
echo "docker-compose.yml no publica el 81 del gateway:"
# Un mapeo "<host>:81" publicaría el listener que confía en CF-Connecting-IP.
if grep -Eq '^\s*-\s*"?[0-9.:]+:81"?\s*$' docker-compose.yml; then
  mal "el compose publica el puerto 81 — cualquiera podría falsificar CF-Connecting-IP"
else
  ok "solo se publica 8080:80"
fi

echo
if [ "$fallos" -eq 0 ]; then echo "Todo OK."; else echo "$fallos verificación(es) fallaron."; exit 1; fi
