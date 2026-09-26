# Instalasi WARUNG BU CUCUN di Server Lokal (Ubuntu 22.04 / 24.04)

Panduan ini untuk komputer/server di warung (atau VPS). Setelah selesai, aplikasi bisa dibuka dari
komputer kasir, tablet, atau HP yang tersambung ke WiFi/LAN yang sama, misalnya `http://192.168.1.10`.

Susunan aplikasi:

| Bagian    | Teknologi                         | Berjalan sebagai                     |
|-----------|-----------------------------------|--------------------------------------|
| Database  | MongoDB 7                         | service `mongod`                     |
| Backend   | Python 3.11 + FastAPI (port 8001) | service systemd `warung-api`         |
| Frontend  | React (file statis hasil build)   | disajikan oleh Nginx (port 80)       |
| Terjadwal | cron Linux                        | laporan malam, backup, WA pagi       |

---

## 0. Ambil kode dari Emergent

Pakai **Save to GitHub** di Emergent, lalu di server jalankan:

```bash
sudo mkdir -p /opt/warung && sudo chown $USER /opt/warung
git clone https://github.com/AKUN-ANDA/NAMA-REPO.git /opt/warung
cd /opt/warung
```

> Folder `/opt/warung` dipakai di seluruh panduan ini. Kalau Anda memakai folder lain, sesuaikan
> path di `deploy/warung-api.service`, `deploy/nginx-warung.conf`, dan `deploy/crontab.txt`.

---

## Cara cepat: skrip otomatis

```bash
cd /opt/warung
sudo bash deploy/install.sh
```

Skrip ini menjalankan langkah 1–7 di bawah secara otomatis: memasang MongoDB, Python, Node, dan Nginx,
membuat `.env` dengan secret acak, mengisi data awal, build frontend, lalu menyalakan service.
Anda bisa langsung loncat ke **Langkah 8 (Uji coba)**. Kalau ada langkah yang gagal, ikuti langkah
manual di bawah.

---

## 1. Paket sistem

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx curl git gnupg
```

Python yang dibutuhkan versi **3.11 atau lebih baru** (cek dengan `python3 --version`). Ubuntu 22.04
bawaannya 3.10. Kalau Anda memakai 22.04:

```bash
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt install -y python3.11 python3.11-venv
```

Lalu ganti `python3` dengan `python3.11` pada langkah 3.

## 2. MongoDB 7

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
mongosh --eval 'db.runCommand({ping:1})'   # harus menampilkan ok: 1
```

> Untuk Ubuntu 24.04 (noble), ganti `$(lsb_release -cs)` dengan `jammy` kalau repo noble belum tersedia.
> MongoDB hanya mendengarkan `127.0.0.1`, jadi tidak terbuka ke jaringan. Biarkan seperti itu.

## 3. Backend

```bash
cd /opt/warung/backend
python3 -m venv venv
source venv/bin/activate
grep -v '^emergentintegrations' requirements.txt > /tmp/req-local.txt   # paket khusus Emergent, tidak dipakai aplikasi
pip install --upgrade pip && pip install -r /tmp/req-local.txt
```

Buat file `backend/.env` (salin dari contoh):

```bash
cp /opt/warung/deploy/backend.env.example /opt/warung/backend/.env
nano /opt/warung/backend/.env
```

Isi yang wajib diganti:

| Variabel              | Isi                                                                 |
|-----------------------|---------------------------------------------------------------------|
| `JWT_SECRET`          | teks acak panjang, buat dengan: `openssl rand -hex 32`              |
| `WEBHOOK_CRON_SECRET` | teks acak lain (untuk jadwal otomatis): `openssl rand -hex 24`      |
| `CORS_ORIGINS`        | alamat yang dipakai membuka aplikasi, mis. `http://192.168.1.10`    |
| `APP_URL`             | sama dengan di atas                                                 |

Isi data awal (akun, kategori, dan produk contoh). **Jalankan sekali saja** di database yang masih kosong:

```bash
cd /opt/warung/backend && source venv/bin/activate
python seed.py
```

> Kalau Anda memindahkan data dari Emergent, **jangan** jalankan seed. Pakai restore backup (langkah 9).

## 4. Service backend (systemd)

```bash
sudo cp /opt/warung/deploy/warung-api.service /etc/systemd/system/
sudo sed -i "s/^User=.*/User=$USER/" /etc/systemd/system/warung-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now warung-api
curl -s http://127.0.0.1:8001/api/   # harus ada respons JSON
```

Log backend: `journalctl -u warung-api -f`

> Kalau lebih suka PM2: `pm2 start "venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001 --workers 1" --name warung-api --cwd /opt/warung/backend && pm2 save && pm2 startup`.
> Tetap pakai **1 worker**, karena pengiriman WA promo berjalan di proses backend.

## 5. Frontend (build)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g yarn
cd /opt/warung/frontend
yarn install --frozen-lockfile
yarn build            # hasil build ada di frontend/dist
```

## 6. Nginx

```bash
sudo cp /opt/warung/deploy/nginx-warung.conf /etc/nginx/sites-available/warung
sudo ln -sf /etc/nginx/sites-available/warung /etc/nginx/sites-enabled/warung
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Nginx menyajikan `frontend/dist` dan meneruskan `/api` ke backend di `127.0.0.1:8001`.
Supaya Nginx bisa membaca folder build: `sudo chmod o+rx /opt /opt/warung /opt/warung/frontend /opt/warung/frontend/dist`.

## 7. Jadwal otomatis (cron)

Di Emergent, jadwal ini diatur oleh platform. Di server sendiri, pakai cron Linux:

```bash
crontab -e
```

Salin isi `deploy/crontab.txt`, lalu ganti `ISI_WEBHOOK_CRON_SECRET` dengan nilai `WEBHOOK_CRON_SECRET` di `.env`:

| Jam (WIB) | Tugas                                                               |
|-----------|---------------------------------------------------------------------|
| 23:55     | Simpan laporan penjualan harian                                     |
| 23:59     | Backup database otomatis (14 terakhir disimpan)                     |
| 07:00     | Ringkasan WA pagi + ucapan ulang tahun member (butuh token Fonnte)  |

> Pastikan zona waktu server Asia/Jakarta: `sudo timedatectl set-timezone Asia/Jakarta`.

## 8. Uji coba

1. Cari IP server: `hostname -I`, misalnya `192.168.1.10`.
2. Dari komputer kasir, buka `http://192.168.1.10`.
3. Login **admin / admin123**, lalu **segera ganti password** di menu Pengguna. Atur juga PIN admin.
4. Login **kasir / kasir123** di komputer kasir, ganti passwordnya juga.
5. Coba satu transaksi, cetak struk, lalu cek Dashboard.

Kalau firewall aktif: `sudo ufw allow 80/tcp` (dan `443/tcp` kalau memakai HTTPS).

## 9. Memindahkan data dari Emergent (opsional)

1. Di aplikasi Emergent: menu **Backup**, klik **Backup Sekarang**, lalu **Download** (file `.json.gz`).
2. Di server lokal (setelah langkah 1–8, **tanpa** seed, atau database dibiarkan kosong): login admin, buka
   menu **Backup**, pilih **Restore dari file**, lalu unggah file tadi.
3. Token Fonnte ikut tersimpan di database. Kalau tidak ikut, isi lagi di **Pengaturan**.

## 10. Printer thermal & scanner

- **Printer:** pasang driver printer thermal (58/80mm) di komputer kasir dan jadikan printer default.
  Atur ukuran kertas di driver dan margin **None**. Untuk cetak tanpa dialog, buka Chrome dengan:
  `chrome --kiosk-printing http://192.168.1.10/pos`.
- **Scanner barcode USB:** cukup dicolokkan, tidak perlu driver. Scanner bekerja seperti keyboard.
- **Layar pelanggan:** buka `http://192.168.1.10/display` di monitor kedua.

## 11. HTTPS (kalau memakai domain / VPS)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d kasir.domainanda.com
```

Setelah itu ubah `CORS_ORIGINS` dan `APP_URL` di `.env` menjadi `https://kasir.domainanda.com`, lalu
jalankan `sudo systemctl restart warung-api`.

## 12. Perawatan harian

| Keperluan               | Perintah                                                                 |
|-------------------------|--------------------------------------------------------------------------|
| Status service          | `systemctl status warung-api mongod nginx`                               |
| Restart backend         | `sudo systemctl restart warung-api`                                      |
| Log error backend       | `journalctl -u warung-api -n 100`                                        |
| Backup manual (Mongo)   | `mongodump --db warung_bu_cucun --gzip --out ~/backup-$(date +%F)`       |
| Salin backup ke flashdisk | salin folder `/opt/warung/backend/backups/`                            |
| Update aplikasi         | `cd /opt/warung && git pull && sudo bash deploy/update.sh`               |

**Sangat disarankan:** salin file backup ke flashdisk atau Google Drive seminggu sekali.
Kalau disk server rusak, backup di server yang sama ikut hilang.

## Masalah umum

| Gejala                           | Solusi                                                                                 |
|----------------------------------|----------------------------------------------------------------------------------------|
| Halaman putih / 404 saat refresh | Pastikan `try_files ... /index.html` ada di konfigurasi Nginx                          |
| "Belum login" terus              | Buka lewat alamat yang sama dengan `CORS_ORIGINS`, dan jangan campur IP dengan nama host |
| 502 Bad Gateway                  | Backend mati: `journalctl -u warung-api -n 50`                                         |
| Jam laporan tidak cocok          | `STORE_TZ=Asia/Jakarta` di `.env` + `timedatectl set-timezone Asia/Jakarta`            |
| WA tidak terkirim                | Isi token Fonnte di Pengaturan; pastikan server terhubung ke internet                  |
