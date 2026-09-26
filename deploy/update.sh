#!/usr/bin/env bash
# Update aplikasi setelah `git pull`. Data & .env tidak disentuh.
# Pemakaian:  cd /opt/warung && git pull && sudo bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"

echo "==> Backup database sebelum update"
DB_NAME="$(grep '^DB_NAME=' "$APP_DIR/backend/.env" | cut -d= -f2)"
mkdir -p "$APP_DIR/backend/backups/pre-update"
mongodump --quiet --db "$DB_NAME" --gzip --out "$APP_DIR/backend/backups/pre-update/$(date +%F-%H%M)"

echo "==> Dependency backend"
cd "$APP_DIR/backend"
grep -v '^emergentintegrations' requirements.txt > /tmp/req-local.txt
sudo -u "$RUN_USER" venv/bin/pip install -q -r /tmp/req-local.txt
systemctl restart warung-api

echo "==> Build frontend"
cd "$APP_DIR/frontend"
sudo -u "$RUN_USER" yarn install --frozen-lockfile
sudo -u "$RUN_USER" yarn build
chmod -R o+r dist
systemctl reload nginx

for i in $(seq 1 20); do curl -sf http://127.0.0.1:8001/api/ >/dev/null && break; sleep 1; done
echo "Update selesai."
