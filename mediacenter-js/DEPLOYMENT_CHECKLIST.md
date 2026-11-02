# Checklist sebelum production publish

## Source wajib

- [ ] Pulihkan folder `views/` lengkap dari source asli.
- [ ] Pulihkan folder `public/` lengkap (CSS, JavaScript, gambar, font, logo, dan aset lain).
- [ ] Bandingkan semua include/partial EJS dan URL aset dengan route di `server.js`.
- [ ] Pastikan file upload lama tersedia di `public/assets/img/berita/` bila masih direferensikan database.

## Database

- [ ] Verifikasi backup database sebelum perubahan apa pun.
- [ ] Pastikan `DB_NAME` mengarah ke database produksi yang benar.
- [ ] Cocokkan kolom `users`, `berita`, `pengaturan`, dan `kualitas_udara` dengan query pada repository/server.
- [ ] Pastikan user database hanya memiliki hak minimum yang diperlukan.
- [ ] Pastikan tabel `admin_sessions` tersedia; skema ada di `database/schema.sql`.
- [ ] Uji baca/tulis data menggunakan salinan database staging terlebih dahulu.

## Keamanan

- [ ] Rotasi password database dan secret yang pernah ada pada arsip lama.
- [ ] Isi `SESSION_SECRET` dengan nilai acak minimal 32 karakter.
- [ ] Aktifkan HTTPS dan cookie secure.
- [ ] Set `TRUST_PROXY=1` hanya jika berada di belakang reverse proxy terpercaya.
- [ ] Pastikan direktori upload tidak mengeksekusi file dan hanya menyajikan tipe file yang diizinkan.
- [ ] Periksa CSP terhadap seluruh template sebelum memperketat policy agar tidak mematahkan fitur.
- [ ] Lakukan uji akses anonim, login, logout, CSRF, upload, edit, hapus, dan pembatasan percobaan login.

## Release gate

- [ ] `npm ci` berhasil pada mesin build bersih.
- [ ] `npm test` berhasil.
- [ ] Jalankan seluruh halaman publik dan admin pada staging.
- [ ] Uji integrasi MySQL dengan database staging, bukan database produksi.
- [ ] Uji reverse proxy/HTTPS, restart proses, dan pemulihan setelah server restart.
- [ ] Pastikan backup dan prosedur rollback tersedia.

**Status paket saat ini:** belum memenuhi release gate karena source yang diterima tidak menyertakan `views/` dan `public/`. Pengujian yang lulus saat ini hanya memverifikasi redirect dashboard untuk pengguna anonim.
