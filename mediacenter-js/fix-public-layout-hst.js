'use strict';
/**
 * Instalasi header dan banner Media Center HST untuk halaman PUBLIK.
 * Letakkan file ini tepat di sebelah server.js, jalankan sekali:
 *   node fix-public-layout-hst.js
 * Backup dibuat untuk setiap halaman yang diubah.
 * Dashboard admin dan server.js tidak disentuh.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const partials = path.join(root, 'views', 'partials');
const publicTop = path.join(partials, 'public-top.ejs');
const brand = path.join(partials, 'public-brand.ejs');
const fallbackBrand = path.join(root, 'setup', 'public-brand-fallback.ejs');
const files = ['index', 'berita', 'tentang'];
const assets = ['banner-hst-panjang-animasi.svg', 'banner-hst-mobile-animasi.svg'];

function fail(msg) {
  console.error('GAGAL: ' + msg);
  process.exitCode = 1;
}

function install() {
  if (!fs.existsSync(path.join(root,'server.js'))) {
    return fail('Jalankan dari folder mediacenter-js yang berisi server.js. Lokasi sekarang: ' + root);
  }
  if (!fs.existsSync(publicTop)) {
    return fail('Tidak ditemukan views/partials/public-top.ejs. Ekstrak semua isi ZIP ke folder mediacenter-js.');
  }
  for (const filename of assets) {
    const p = path.join(root, 'public','assets','img',filename);
    if (!fs.existsSync(p)) {
      return fail('Aset banner belum ada: public/assets/img/' + filename + '. Salin dari ZIP terlebih dahulu.');
    }
  }
  if (!fs.existsSync(brand)) {
    if (!fs.existsSync(fallbackBrand)) {
      return fail('views/partials/public-brand.ejs tidak tersedia dan file cadangannya tidak ada.');
    }
    fs.mkdirSync(partials, {recursive:true});
    fs.copyFileSync(fallbackBrand, brand, fs.constants.COPYFILE_EXCL);
    console.log('OK: Menambahkan public-brand.ejs (sebelumnya tidak ada).');
  }
  for (const page of files) {
    const filepath = path.join(root,'views','public',page + '.ejs');
    if (!fs.existsSync(filepath)) { fail('Halaman tidak ada: views/public/' + page + '.ejs'); continue; }
    const source = fs.readFileSync(filepath, 'utf8');
    if (/include\(\s*['"]\.\.\/partials\/public-top['"]\s*\)/.test(source)) {
      console.log('SKIP: ' + page + '.ejs sudah menggunakan banner & header bersama.');
      continue;
    }
    const header = /<%-\s*include\(\s*['"]\.\.\/partials\/header['"]\s*\)\s*%>/.exec(source);
    if (!header) { fail(page+'.ejs: include partial header tidak ditemukan; tidak diubah.'); continue; }
    const endHeader = header.index + header[0].length;
    const main = /<main\b/i.exec(source.slice(endHeader));
    if (!main) { fail(page+'.ejs: elemen <main> tidak ditemukan; tidak diubah.'); continue; }
    const mainAt = endHeader + main.index;
    const oldTop = source.slice(endHeader,mainAt);
    // Jangan menghapus region yang tidak dikenal (misalnya logic khusus di antara header dan main).
    if (!/(public-brand|mc-app-brand)/.test(oldTop) || !/(public-nav|mc-app-nav)/.test(oldTop)) {
      fail(page+'.ejs: pola header lama tidak sesuai. File tidak diubah; kirim 120 baris awal file untuk pemeriksaan.');
      continue;
    }
    const data = page === 'index'
      ? [...oldTop.matchAll(/<%(?![-=])([\s\S]*?)%>/g)]
          .filter(m => /\bconst\s+(beritaUtama|beritaTerbaru)\b/.test(m[1]))
          .map(m => m[0]).join('\n\n')
      : '';
    const replacement = `
<%- include('../partials/public-top') %>

` + (data ? data + '\n\n' : '');
    let after = source.slice(mainAt);
    // Sesuaikan target tautan "Lewati navigasi".
    after = after.replace(/^<main(?![^>]*\bid=)([^>]*)>/i, '<main id="konten-utama"$1>');
    const patched = source.slice(0,endHeader) + replacement + after;
    if (patched === source) { console.log('SKIP: '+page+'.ejs tidak berubah.'); continue; }
    const backup = filepath + '.sebelum-header-bersama.bak';
    if (!fs.existsSync(backup)) fs.copyFileSync(filepath, backup);
    fs.writeFileSync(filepath,patched,'utf8');
    console.log('OK: views/public/'+page+'.ejs (backup tersimpan)');
  }
  if (process.exitCode) console.log('Sebagian halaman belum berubah. Baca pesan GAGAL di atas.');
  else console.log('\nBERHASIL: Ketiga halaman publik menggunakan logo, banner SVG animasi, dan navigasi seragam.\nBuka Beranda, Berita, Tentang lalu Ctrl + Shift + R.');
}
install();
