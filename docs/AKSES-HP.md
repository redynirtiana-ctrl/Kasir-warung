# Membuka Kasir dari HP Saat di Luar Warung (Aman)

Tujuannya: pemilik bisa membuka Dashboard, Laporan, Stok, dan Piutang dari HP di mana saja,
**tanpa** membuka server warung ke seluruh internet.

## Pilihan

| Cara | Keamanan | Biaya | Perlu domain? | Rekomendasi |
|---|---|---|---|---|
| **A. Tailscale** (jaringan pribadi / VPN) | Sangat aman: hanya HP yang Anda daftarkan yang bisa masuk | Gratis (sampai 100 perangkat) | Tidak | ✅ **Paling disarankan** |
| B. Cloudflare Tunnel + Cloudflare Access | Aman: harus login email dulu, baru terlihat halaman kasir | Gratis (butuh domain ± Rp150rb/tahun) | Ya | Kalau ingin alamat seperti `kasir.warungbucucun.com` |
| ~~C. Port forwarding di router~~ | ❌ Berbahaya: server terbuka ke internet, jadi sasaran bot | – | – | **Jangan dipakai** |

---

## A. Tailscale (disarankan)

Tailscale membuat "jaringan WiFi pribadi" antara server warung dan HP Anda lewat internet.
Semua data terenkripsi (WireGuard). Orang lain tidak bisa melihat server Anda sama sekali.

### 1) Di server warung

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Akan muncul sebuah link. Buka link itu di browser, lalu login dengan akun **Google milik pemilik**.
Setelah berhasil:

```bash
tailscale ip -4          # contoh hasil: 100.101.102.103
```

Beri nama server yang mudah diingat di https://login.tailscale.com/admin/machines (misal `warung`).

### 2) HTTPS gratis (disarankan)

```bash
sudo tailscale serve --bg 80
tailscale serve status   # tampil alamat seperti https://warung.tail1234.ts.net
```

Di halaman admin Tailscale → **DNS**, aktifkan **MagicDNS** dan **HTTPS Certificates** kalau diminta.

Tambahkan alamat itu ke `backend/.env` (pisahkan dengan koma), lalu restart:

```bash
nano /opt/warung/backend/.env
# CORS_ORIGINS=http://192.168.1.10,https://warung.tail1234.ts.net,http://100.101.102.103
sudo systemctl restart warung-api
```

### 3) Di HP pemilik

1. Pasang aplikasi **Tailscale** dari Play Store / App Store.
2. Login dengan **akun Google yang sama**, lalu aktifkan (ON).
3. Buka Chrome/Safari: `https://warung.tail1234.ts.net` (atau `http://100.101.102.103`).
4. Login dengan akun **admin**.
5. Supaya terasa seperti aplikasi: menu browser → **Tambahkan ke Layar Utama**.

> Kalau Tailscale di HP dimatikan, halaman kasir tidak bisa dibuka. Artinya memang aman.
> Di rumah atau di mana pun, cukup nyalakan Tailscale.

### 4) Kunci akses (opsional, lebih aman)

Di https://login.tailscale.com/admin/acls, batasi agar hanya HP pemilik yang boleh mengakses server.
Kasir di warung tetap memakai alamat LAN biasa (`http://192.168.1.10`), jadi tidak perlu Tailscale.

---

## B. Cloudflare Tunnel (kalau ingin pakai domain sendiri)

1. Beli domain lalu pindahkan DNS-nya ke Cloudflare (gratis).
2. Di server:
   ```bash
   curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
   echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
   sudo apt update && sudo apt install -y cloudflared
   ```
3. Di dashboard Cloudflare → **Zero Trust → Networks → Tunnels → Create tunnel**. Salin perintah
   `sudo cloudflared service install <TOKEN>` dan jalankan di server.
4. Tambahkan *Public hostname*: `kasir.domainanda.com` → Service `http://localhost:80`.
5. **Wajib:** Zero Trust → **Access → Applications → Add** untuk `kasir.domainanda.com`, dengan policy
   *Allow* hanya email pemilik. Dengan begitu, orang lain harus lolos login Cloudflare (kode ke email)
   sebelum bisa melihat halaman login kasir.
6. Tambahkan `https://kasir.domainanda.com` ke `CORS_ORIGINS`, lalu `sudo systemctl restart warung-api`.

---

## Daftar periksa keamanan (wajib)

- [ ] Password `admin` dan `kasir` **sudah diganti** (jangan pakai admin123/kasir123). Minimal 10 karakter.
- [ ] PIN admin sudah diatur dan tidak diberitahukan ke kasir.
- [ ] Akun kasir **tidak** diberi izin "Lihat laporan" kalau tidak perlu.
- [ ] Router warung **tidak** melakukan port forwarding ke server (cek menu *Virtual Server / NAT*).
- [ ] MongoDB hanya `127.0.0.1` (dicek otomatis oleh `sudo bash deploy/check.sh`).
- [ ] HP pemilik memakai kunci layar (PIN/sidik jari). Kalau HP hilang: hapus perangkat itu di admin
      Tailscale, lalu ganti password admin.
- [ ] Setelah selesai memakai di HP umum/HP orang lain, klik **Keluar**.
- [ ] Update server sebulan sekali: `sudo apt update && sudo apt upgrade -y`.

## Masalah umum

| Gejala | Solusi |
|---|---|
| Halaman tidak terbuka dari HP | Pastikan Tailscale di HP **ON** dan server online (`tailscale status` di server) |
| Terbuka, tapi login gagal / "Belum login" | Tambahkan alamat yang dipakai ke `CORS_ORIGINS`, restart `warung-api`, lalu hapus cookie browser |
| Lambat | Wajar kalau internet warung lemah. Laporan & Dashboard tetap bisa dipakai |
| Server mati listrik | Pasang UPS kecil. Aktifkan "Restore on AC power loss" di BIOS supaya server menyala sendiri |
