# Media Center Kabupaten Hulu Sungai Tengah

Aplikasi menggunakan Node.js 20+, Express 4, EJS, MySQL/MariaDB, dan `mysql2`.

## Penting: kelengkapan source

Paket yang diterima untuk perbaikan ini tidak menyertakan direktori `views/` dan `public/` yang dibutuhkan aplikasi untuk merender halaman dan menyajikan aset. Karena itu paket ini **belum dapat dipublikasikan sebagai aplikasi lengkap** sampai kedua direktori tersebut dipulihkan dari source asli. Folder `test/` dan `scripts/` yang hilang juga telah dibuat kembali hanya untuk pengujian akses dashboard dan pembuatan akun administrator.

## Instalasi

1. Gunakan Node.js 20 atau lebih baru.
2. Jalankan `npm ci`.
3. Salin `.env.example` menjadi `.env`.
4. Isi `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, dan `SESSION_SECRET` sesuai server.
5. Pastikan database dan tabel aplikasi tersedia. `database/schema.sql` hanya untuk instalasi baru; jangan impor untuk mereset database produksi.
6. Buat akun admin jika diperlukan:

   ```bash
   npm run seed:admin -- nama_admin 'PasswordKuatMinimal12Karakter'
   ```

7. Jalankan `npm start`.

## Session dan keamanan

- Session administrator disimpan di MySQL pada tabel `admin_sessions`; tabel dibuat otomatis saat session store pertama kali digunakan.
- User database harus memiliki izin `CREATE TABLE`, `SELECT`, `INSERT`, `UPDATE`, dan `DELETE` pada database aplikasi. Jika kebijakan server tidak mengizinkan DDL saat runtime, buat tabel `admin_sessions` secara manual dengan struktur yang sama seperti pada `lib/mysql-session-store.js`.
- Gunakan HTTPS di production. Set `TRUST_PROXY=1` hanya jika aplikasi berada di belakang reverse proxy yang kamu kendalikan.
- Gunakan secret acak minimal 32 karakter untuk `SESSION_SECRET`. Jangan unggah `.env` ke repositori atau ZIP publik.
- Ganti/rotasi kredensial yang pernah ikut terkirim dalam arsip sebelumnya.
- Backup database dan direktori upload secara berkala.

## Pengujian

```bash
npm test
```

Pengujian yang tersedia memverifikasi bahwa dashboard admin mengarahkan pengguna anonim ke halaman login. Ini belum menggantikan pengujian browser, integrasi MySQL, upload, dan seluruh halaman.

## Catatan database

`database/schema.sql` menggunakan `CREATE TABLE IF NOT EXISTS` dan tidak menghapus tabel/data. Struktur tabel pada database produksi tetap harus dibandingkan dengan query di `lib/repository.js` sebelum migrasi apa pun. Pastikan `DB_NAME` menunjuk ke database yang sama untuk repository, session, dan fitur kualitas udara.
