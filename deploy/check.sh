#!/usr/bin/env bash
# Diagnosa instalasi WARUNG BU CUCUN. Tidak mengubah apa pun, hanya memeriksa.
# Pemakaian:  sudo warung-check        (setelah install.sh)
#         atau sudo bash /opt/warung/deploy/check.sh   (dari folder mana pun)
# Kirim seluruh hasilnya ke developer/AI kalau ada baris [GAGAL].
APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"  # works via symlink / any cwd
OK=0; FAIL=0; WARN=0
ok()   { echo -e "  \033[32m[OK]\033[0m    $*"; OK=$((OK+1)); }
fail() { echo -e "  \033[31m[GAGAL]\033[0m $1"; [ -n "${2:-}" ] && echo -e "          -> Solusi: $2"; FAIL=$((FAIL+1)); }
warn() { echo -e "  \033[33m[PERINGATAN]\033[0m $1"; [ -n "${2:-}" ] && echo -e "          -> $2"; WARN=$((WARN+1)); }
sec()  { echo -e "\n\033[1m== $* ==\033[0m"; }
envget() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']\$//"; }  # strips optional quotes like python-dotenv

sec "Sistem"
. /etc/os-release 2>/dev/null; echo "  OS: ${PRETTY_NAME:-?} | Arsitektur: $(uname -m) | Folder: $APP_DIR"
[ "$(uname -m)" = "x86_64" ] || warn "Arsitektur $(uname -m): MongoDB resmi butuh x86_64 (atau ARM64 v8.2+)" "Disarankan PC/mini-PC Intel/AMD"
grep -qw avx /proc/cpuinfo && ok "CPU mendukung AVX (syarat MongoDB 5+)" \
  || fail "CPU TIDAK mendukung AVX — MongoDB 5/6/7/8 tidak bisa jalan" "Lihat docs/INSTALL-LOCAL.md bagian 'CPU lama tanpa AVX' (pakai MongoDB 4.4 via Docker)"
TZNOW="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null)"
[ "$TZNOW" = "Asia/Jakarta" ] && ok "Zona waktu Asia/Jakarta" || warn "Zona waktu: ${TZNOW:-?}" "sudo timedatectl set-timezone Asia/Jakarta"
FREE_GB=$(df -BG --output=avail "$APP_DIR" | tail -1 | tr -dc 0-9)
[ "${FREE_GB:-0}" -ge 3 ] && ok "Sisa disk ${FREE_GB} GB" || warn "Sisa disk hanya ${FREE_GB} GB" "Kosongkan disk (minimal 3 GB)"
MEM_MB=$(free -m | awk '/Mem:/{print $2}')
[ "${MEM_MB:-0}" -ge 1800 ] && ok "RAM ${MEM_MB} MB" || warn "RAM ${MEM_MB} MB (disarankan >= 2 GB)" "Build frontend bisa gagal: tambah swap 2 GB"

sec "Program"
PYBIN="$APP_DIR/backend/venv/bin/python"
if [ -x "$PYBIN" ]; then
  V=$("$PYBIN" -c 'import sys;print("%d.%d"%sys.version_info[:2])')
  "$PYBIN" -c 'import sys;sys.exit(0 if sys.version_info>=(3,11) else 1)' && ok "Python venv $V" || fail "Python venv $V (butuh >= 3.11)" "Hapus backend/venv lalu jalankan ulang install.sh"
  "$PYBIN" -c 'import fastapi, motor, pandas, reportlab, openpyxl, bcrypt, passlib, jwt' 2>/dev/null && ok "Paket Python lengkap" \
    || fail "Paket Python belum lengkap" "cd $APP_DIR/backend && grep -v ^emergentintegrations requirements.txt > /tmp/r.txt && venv/bin/pip install -r /tmp/r.txt"
else
  fail "backend/venv belum ada" "sudo bash deploy/install.sh"
fi
if command -v node >/dev/null; then
  NV=$(node -v); NMAJ=$(echo "$NV" | cut -c2- | cut -d. -f1); NMIN=$(echo "$NV" | cut -d. -f2)
  if [ "$NMAJ" -ge 22 ] || { [ "$NMAJ" -eq 20 ] && [ "$NMIN" -ge 19 ]; }; then ok "Node.js $NV"; else fail "Node.js $NV terlalu lama (Vite 8 butuh 20.19+ / 22.12+)" "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"; fi
else fail "Node.js belum terpasang" "sudo bash deploy/install.sh"; fi
command -v yarn >/dev/null && ok "yarn $(yarn -v)" || fail "yarn belum terpasang" "sudo npm install -g yarn"
command -v mongod >/dev/null && ok "MongoDB $(mongod --version | head -1 | awk '{print $3}')" || fail "MongoDB belum terpasang" "sudo bash deploy/install.sh"
command -v mongodump >/dev/null && ok "mongodump tersedia" || warn "mongodump tidak ada (dipakai update.sh)" "sudo apt install -y mongodb-database-tools"

sec "Konfigurasi"
ENVF="$APP_DIR/backend/.env"
if [ -f "$ENVF" ]; then
  ok "backend/.env ada"
  for k in MONGO_URL DB_NAME JWT_SECRET WEBHOOK_CRON_SECRET CORS_ORIGINS STORE_TZ; do
    v="$(envget "$k" "$ENVF")"
    if [ -z "$v" ]; then fail "$k kosong di .env" "Isi $k (lihat deploy/backend.env.example)"
    elif echo "$v" | grep -q "GANTI_DENGAN"; then fail "$k masih nilai contoh" "Ganti dengan: openssl rand -hex 32"
    elif echo "$v" | grep -q "emergentagent\|emergent.host"; then fail "$k masih alamat Emergent" "Ubah ke http://$(hostname -I | awk '{print $1}')"
    fi
  done
  [ "$(stat -c %a "$ENVF")" = "600" ] && ok ".env hanya bisa dibaca pemilik" || warn ".env bisa dibaca user lain" "chmod 600 $ENVF"
else fail "backend/.env tidak ada" "cp deploy/backend.env.example backend/.env lalu isi"; fi
[ -f "$APP_DIR/frontend/dist/index.html" ] && ok "Frontend sudah di-build" || fail "frontend/dist belum ada" "cd $APP_DIR/frontend && yarn install --frozen-lockfile && yarn build"

sec "Service"
for s in mongod warung-api nginx; do
  systemctl is-active --quiet "$s" && ok "service $s aktif" || fail "service $s TIDAK aktif" "sudo systemctl restart $s ; lihat log: journalctl -u $s -n 50"
done
systemctl is-enabled --quiet warung-api 2>/dev/null && ok "warung-api otomatis jalan saat boot" || warn "warung-api belum di-enable" "sudo systemctl enable warung-api"

sec "Koneksi"
if mongosh --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1; then ok "MongoDB menjawab"; else fail "MongoDB tidak menjawab" "journalctl -u mongod -n 50 (cek juga AVX di atas)"; fi
if ss -ltn 2>/dev/null | grep -q '0.0.0.0:27017\|\*:27017'; then warn "MongoDB terbuka ke jaringan" "Set bindIp: 127.0.0.1 di /etc/mongod.conf"; fi
curl -sf http://127.0.0.1:8001/api/ >/dev/null && ok "Backend menjawab di 127.0.0.1:8001" || fail "Backend tidak menjawab" "journalctl -u warung-api -n 80"
curl -sf http://127.0.0.1/api/ >/dev/null && ok "Nginx meneruskan /api ke backend" || fail "Nginx -> backend gagal" "sudo nginx -t ; cek /etc/nginx/sites-enabled/warung"
curl -sf http://127.0.0.1/ | grep -qi "<html" && ok "Halaman aplikasi tampil lewat Nginx" || fail "Halaman tidak tampil" "Cek izin folder: sudo chmod -R o+rX $APP_DIR/frontend/dist dan o+x pada folder induknya"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"x","password":"y"}')
[ "$CODE" = "401" ] || [ "$CODE" = "400" ] || [ "$CODE" = "429" ] && ok "API login merespons (HTTP $CODE untuk akun salah)" || fail "API login merespons HTTP $CODE" "journalctl -u warung-api -n 80"
DBN="$(envget DB_NAME "$ENVF")"
UC=$(mongosh --quiet --eval "db.getSiblingDB('${DBN:-warung_bu_cucun}').users.countDocuments()" 2>/dev/null)
[ "${UC:-0}" -gt 0 ] 2>/dev/null && ok "Database berisi ${UC} pengguna" || fail "Database belum berisi pengguna" "cd $APP_DIR/backend && venv/bin/python seed.py  (atau restore backup)"

sec "Jadwal otomatis & backup"
CT="$(crontab -u "${SUDO_USER:-$(whoami)}" -l 2>/dev/null)"
for j in daily-report backup morning-summary; do
  echo "$CT" | grep -q "/api/v1/cron/$j" && ok "cron $j terpasang" || fail "cron $j belum terpasang" "crontab -e lalu salin deploy/crontab.txt (ganti secret)"
done
SEC="$(envget WEBHOOK_CRON_SECRET "$ENVF")"
if [ -n "$SEC" ] && echo "$CT" | grep -q "/api/v1/cron/"; then
  echo "$CT" | grep "/api/v1/cron/" | grep -q "Bearer $SEC" && ok "Secret cron cocok dengan .env" || fail "Secret di crontab TIDAK cocok dengan .env" "Jalankan ulang: sudo bash deploy/install.sh (crontab ditulis ulang)"
fi
BK="$APP_DIR/backend/backups"
LAST=$(ls -t "$BK"/wbc-backup-*.json.gz 2>/dev/null | head -1)
[ -n "$LAST" ] && ok "Backup terakhir: $(basename "$LAST")" || warn "Belum ada file backup" "Menu Backup -> Backup Sekarang"
[ -f /etc/udev/rules.d/99-warung-usb.rules ] && ok "Aturan mount flashdisk otomatis terpasang" || warn "Aturan mount flashdisk belum ada (Ubuntu Server)" "Jalankan ulang install.sh (Ubuntu Desktop tidak perlu)"
if command -v rclone >/dev/null; then
  ok "rclone terpasang ($(rclone version | head -1 | awk '{print $2}'))"
  RU="${SUDO_USER:-$(whoami)}"
  if sudo -u "$RU" -H rclone listremotes 2>/dev/null | grep -q '^gdrive:'; then
    sudo -u "$RU" -H timeout 40 rclone lsd gdrive: --max-depth 1 >/dev/null 2>&1 && ok "Google Drive terhubung (remote gdrive, user $RU)" \
      || fail "Remote gdrive ada tapi tidak bisa diakses" "Cek internet, lalu: sudo -u $RU -H rclone config reconnect gdrive:"
  else
    warn "Google Drive belum dihubungkan (opsional)" "Ikuti docs/GOOGLE-DRIVE.md"
  fi
else
  warn "rclone belum terpasang (untuk Backup ke Google Drive)" "curl https://rclone.org/install.sh | sudo bash"
fi
USBN=$(awk '$2 ~ /^\/(media|run\/media|mnt)\// && $3 ~ /^(vfat|exfat|ntfs|ntfs3|fuseblk)$/' /proc/mounts | wc -l)
[ "$USBN" -gt 0 ] && ok "Flashdisk tercolok: $USBN" || echo "  (info) Tidak ada flashdisk tercolok saat ini"

sec "Ringkasan"
echo "  OK: $OK   PERINGATAN: $WARN   GAGAL: $FAIL"
IP=$(hostname -I | awk '{print $1}')
[ "$FAIL" -eq 0 ] && echo -e "  \033[32mSemua beres. Buka http://$IP dari komputer kasir.\033[0m" || echo "  Perbaiki baris [GAGAL] dari atas ke bawah, lalu jalankan check.sh lagi."
