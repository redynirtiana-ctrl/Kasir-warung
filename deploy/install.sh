#!/usr/bin/env bash
# Instalasi otomatis WARUNG BU CUCUN di Ubuntu 22.04/24.04.
# Pemakaian:  cd /opt/warung && sudo bash deploy/install.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"
IP="$(hostname -I | awk '{print $1}')"
say() { echo -e "\n\033[1;32m==> $*\033[0m"; }
envget() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']\$//"; }  # strips optional quotes like python-dotenv

[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo"; exit 1; }

say "Zona waktu -> Asia/Jakarta"
timedatectl set-timezone Asia/Jakarta || true

say "Cek CPU (MongoDB 5+ butuh instruksi AVX)"
if ! grep -qw avx /proc/cpuinfo; then
  echo "GAGAL: CPU ini tidak mendukung AVX, jadi MongoDB versi baru tidak bisa jalan."
  echo "Lihat docs/INSTALL-LOCAL.md bagian 'CPU lama tanpa AVX'."
  exit 1
fi

say "Paket sistem"
apt-get update
apt-get install -y curl git gnupg nginx software-properties-common lsb-release openssl exfatprogs ntfs-3g

PY=python3
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
  say "Memasang Python 3.11 (deadsnakes)"
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update
  apt-get install -y python3.11 python3.11-venv
  PY=python3.11
else
  apt-get install -y python3-venv python3-pip
fi

if ! command -v mongod >/dev/null; then
  say "Memasang MongoDB 8.0"
  CODENAME="$(lsb_release -cs)"
  case "$CODENAME" in jammy|noble) ;; *) echo "Ubuntu $CODENAME belum didukung MongoDB 8.0 — pakai Ubuntu 22.04/24.04"; exit 1 ;; esac
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${CODENAME}/mongodb-org/8.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-8.0.list
  apt-get update
  apt-get install -y mongodb-org
fi
systemctl enable --now mongod
for i in $(seq 1 30); do mongosh --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1 && break; sleep 1; done

if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 22 ]; then
  say "Memasang Node.js 22 (Vite 8 butuh Node 20.19+/22.12+)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v yarn >/dev/null || npm install -g yarn

say "Backend: virtualenv + dependency"
cd "$APP_DIR/backend"
[ -x venv/bin/python ] && ! venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' && rm -rf venv
sudo -u "$RUN_USER" $PY -m venv venv
grep -v '^emergentintegrations' requirements.txt > /tmp/req-local.txt
sudo -u "$RUN_USER" venv/bin/pip install --upgrade pip
sudo -u "$RUN_USER" venv/bin/pip install -r /tmp/req-local.txt

FIRST_INSTALL=0
if [ ! -f .env ] || grep -q "GANTI_DENGAN\|emergentagent\|emergent.host" .env; then
  say "Membuat backend/.env (secret acak)"
  cp "$APP_DIR/deploy/backend.env.example" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^WEBHOOK_CRON_SECRET=.*|WEBHOOK_CRON_SECRET=$(openssl rand -hex 24)|" .env
  sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://${IP},http://localhost|" .env
  sed -i "s|^APP_URL=.*|APP_URL=http://${IP}|" .env
  chown "$RUN_USER" .env && chmod 600 .env
  FIRST_INSTALL=1
fi
CRON_SECRET="$(envget WEBHOOK_CRON_SECRET .env)"
DB_NAME="$(envget DB_NAME .env)"

if [ "$FIRST_INSTALL" = 1 ]; then
  COUNT="$(mongosh --quiet --eval "db.getSiblingDB('${DB_NAME}').users.countDocuments()" 2>/dev/null || echo 0)"
  if [ "${COUNT:-0}" = "0" ]; then
    say "Mengisi data awal (seed)"
    sudo -u "$RUN_USER" venv/bin/python seed.py
  fi
fi

say "Service backend (systemd)"
sed "s|/opt/warung|${APP_DIR}|g; s|^User=.*|User=${RUN_USER}|" "$APP_DIR/deploy/warung-api.service" > /etc/systemd/system/warung-api.service
systemctl daemon-reload
systemctl enable warung-api
systemctl restart warung-api

say "Frontend: build"
cd "$APP_DIR/frontend"
sudo -u "$RUN_USER" yarn install --frozen-lockfile
sudo -u "$RUN_USER" yarn build

say "Nginx"
sed "s|/opt/warung|${APP_DIR}|g" "$APP_DIR/deploy/nginx-warung.conf" > /etc/nginx/sites-available/warung
ln -sf /etc/nginx/sites-available/warung /etc/nginx/sites-enabled/warung
rm -f /etc/nginx/sites-enabled/default
d="$APP_DIR/frontend/dist"; while [ "$d" != "/" ]; do chmod o+x "$d"; d="$(dirname "$d")"; done
chmod -R o+r "$APP_DIR/frontend/dist"
nginx -t && systemctl reload nginx

if ! command -v rclone >/dev/null; then
  say "Memasang rclone (untuk Backup ke Google Drive)"
  curl -fsSL https://rclone.org/install.sh | bash || echo "PERINGATAN: rclone gagal dipasang — Backup ke Google Drive tidak tersedia"
fi

say "Mount flashdisk otomatis (untuk Backup ke Flashdisk)"
RUID="$(id -u "$RUN_USER")"; RGID="$(id -g "$RUN_USER")"
cat > /etc/udev/rules.d/99-warung-usb.rules <<RULES
# WARUNG BU CUCUN: mount flashdisk (FAT/exFAT/NTFS) ke /media/warung-usb/<nama> agar bisa dipakai menu Backup
ACTION=="add", SUBSYSTEM=="block", ENV{ID_BUS}=="usb", ENV{ID_FS_USAGE}=="filesystem", ENV{ID_FS_TYPE}=="vfat|exfat|ntfs", RUN{program}+="/usr/bin/systemd-mount --no-block --collect --options=uid=${RUID},gid=${RGID},umask=0022 \$devnode /media/warung-usb/%k"
ACTION=="remove", SUBSYSTEM=="block", ENV{ID_BUS}=="usb", RUN{program}+="/usr/bin/systemd-umount /media/warung-usb/%k"
RULES
mkdir -p /media/warung-usb
udevadm control --reload-rules || true

say "Jadwal otomatis (crontab user ${RUN_USER})"
TMP="$(mktemp)"
( sudo -u "$RUN_USER" crontab -l 2>/dev/null | grep -v '/api/v1/cron/' | grep -v '^CRON_TZ=Asia/Jakarta' || true
  sed "s|ISI_WEBHOOK_CRON_SECRET|${CRON_SECRET}|g" "$APP_DIR/deploy/crontab.txt" | grep -v '^#' ) > "$TMP"
sudo -u "$RUN_USER" crontab "$TMP"; rm -f "$TMP"

command -v ufw >/dev/null && ufw status | grep -q active && ufw allow 80/tcp || true

say "Cek kesehatan"
for i in $(seq 1 20); do curl -sf http://127.0.0.1:8001/api/ >/dev/null && break; sleep 1; done
curl -sf http://127.0.0.1/api/ >/dev/null && echo "Backend & Nginx OK" || echo "PERINGATAN: cek 'journalctl -u warung-api -n 50'"

bash "$APP_DIR/deploy/check.sh" || true

cat <<EOF

=========================================================
 Selesai! Buka dari komputer kasir:  http://${IP}
 Login awal: admin / admin123  dan  kasir / kasir123
 SEGERA ganti password & atur PIN admin di menu Pengguna.
=========================================================
EOF
