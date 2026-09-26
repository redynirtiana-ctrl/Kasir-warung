# Backup ke Google Drive (sekali setup, ±5 menit)

Setelah disetup, setiap malam jam 23:59 backup database otomatis diunggah ke Google Drive pemilik
(akun **redynirtiana@gmail.com**) ke folder **WARUNG-BACKUP**. 30 backup terakhir disimpan, yang lebih lama
dipindahkan ke Sampah Drive. Kalau server warung rusak atau hilang, data tetap aman di Google Drive.

Aplikasi memakai **rclone**, program resmi yang populer untuk menyalin file ke Google Drive.
**Tidak perlu** membuat Google Cloud project, API key, atau Client ID.
Izin yang diberikan hanya **drive.file**: rclone hanya bisa melihat file yang ia buat sendiri, bukan
seluruh isi Google Drive Anda.

---

## 1. Pastikan rclone terpasang di server

`deploy/install.sh` sudah memasangnya. Cek:

```bash
rclone version
```

Kalau belum ada: `curl https://rclone.org/install.sh | sudo bash`

## 2. Hubungkan Google Drive

> **Penting:** jalankan sebagai **user yang menjalankan aplikasi**, yaitu user yang dipakai saat
> `sudo bash deploy/install.sh` (lihat `User=` di `/etc/systemd/system/warung-api.service`).
> Pada contoh di bawah user-nya `warung`, ganti sesuai milik Anda.

Di server:

```bash
sudo -u warung -H rclone config
```

Jawab pertanyaan berikut:

| Pertanyaan | Jawaban |
|---|---|
| `n) New remote` | `n` |
| `name>` | `gdrive` (harus persis ini) |
| `Storage>` | ketik `drive` (Google Drive) |
| `client_id>` | kosongkan, tekan Enter |
| `client_secret>` | kosongkan, tekan Enter |
| `scope>` | pilih nomor untuk **`drive.file`** |
| `service_account_file>` | kosongkan, tekan Enter |
| `Edit advanced config?` | `n` |
| `Use web browser to automatically authenticate?` | lihat di bawah |

### A. Server punya layar dan browser (Ubuntu Desktop)
Jawab `y`. Browser akan terbuka. Login dengan **redynirtiana@gmail.com**, lalu klik **Izinkan**.

### B. Server tanpa layar (Ubuntu Server), yang paling umum
1. Jawab `n`. rclone menampilkan perintah `rclone authorize "drive" "...."`.
2. Di **laptop/PC Windows** Anda, unduh rclone dari https://rclone.org/downloads/ lalu ekstrak.
3. Buka *Command Prompt* di folder itu dan jalankan perintah yang ditampilkan server, misalnya:
   ```
   rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"
   ```
4. Browser terbuka. Login dengan **redynirtiana@gmail.com**, lalu klik **Izinkan**.
5. Command Prompt menampilkan kode panjang di antara `--->` dan `<---End paste`. Salin semuanya,
   tempel ke server di prompt `config_token>`, lalu tekan Enter.

Lanjutkan pertanyaan terakhir:

| Pertanyaan | Jawaban |
|---|---|
| `Configure this as a Shared Drive?` | `n` |
| `Keep this "gdrive" remote?` | `y` |
| menu utama | `q` (keluar) |

## 3. Buat folder backup (lewat rclone)

```bash
sudo -u warung -H rclone mkdir gdrive:WARUNG-BACKUP
sudo -u warung -H rclone lsd gdrive:          # harus tampil WARUNG-BACKUP
chmod 600 ~warung/.config/rclone/rclone.conf  # file ini berisi kunci akses, jangan dibagikan
```

> Folder harus dibuat oleh rclone. Kalau dibuat manual di website Google Drive, rclone tidak bisa
> melihatnya karena izinnya hanya `drive.file`.

## 4. Aktifkan di aplikasi

1. Login **admin**, lalu buka menu **Backup**.
2. Di panel **Google Drive pemilik**, klik **Cek ulang**. Status harus **Terhubung**.
3. Klik **Backup ke Google Drive** sekali untuk uji coba. Buka https://drive.google.com, dan file
   `wbc-backup-....json.gz` akan ada di folder **WARUNG-BACKUP**.
4. Centang **Unggah otomatis backup malam**.

Cek juga dengan `sudo warung-check`. Baris "Google Drive terhubung" harus **[OK]**.

---

## Mengembalikan data dari Google Drive

1. Buka Google Drive, masuk ke folder **WARUNG-BACKUP**, lalu unduh file backup terbaru.
2. Di aplikasi (server lama atau server baru), buka **Backup**, pilih **Restore dari file**, lalu pilih file tadi.

## Masalah umum

| Pesan di aplikasi | Solusi |
|---|---|
| rclone belum terpasang di server | `curl https://rclone.org/install.sh \| sudo bash`, lalu `sudo systemctl restart warung-api` |
| Google Drive belum dihubungkan | Ulangi langkah 2 **sebagai user aplikasi** (`sudo -u warung -H ...`) |
| Remote 'gdrive' belum ada | Nama remote harus persis `gdrive` |
| Izin Google Drive kedaluwarsa/dicabut | `sudo -u warung -H rclone config reconnect gdrive:` |
| Folder Google Drive tidak ditemukan | Jalankan langkah 3 (`rclone mkdir gdrive:WARUNG-BACKUP`) |
| Server tidak terhubung ke internet | Backup tetap tersimpan di server dan flashdisk, lalu diunggah pada malam berikutnya |
| Kuota Google Drive penuh | Kosongkan **Sampah** di Google Drive, atau upgrade penyimpanan |

**Keamanan:** file `rclone.conf` berisi kunci akses ke Google Drive. Jangan dikirim ke siapa pun dan
jangan di-upload ke GitHub. Untuk memutus akses kapan saja, buka https://myaccount.google.com/permissions,
pilih **rclone**, lalu **Hapus akses**.
