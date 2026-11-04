
'use strict';

// ======================================================
// 1. DEPENDENCIES
// ======================================================

try {
  require('dotenv').config();
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const { defaultSettings } = require('./helpers');

// ======================================================
// 2. CONFIGURATION
// ======================================================

const isVercel = process.env.VERCEL === '1';

const mode = (
  process.env.DB_MODE || 'json'
).trim().toLowerCase();

let pool = null;

// Vercel tidak boleh menulis ke /var/task.
// /tmp hanya penyimpanan sementara.
const file = path.resolve(
  isVercel
    ? '/tmp/mediacenter-hst/db.json'
    : (
        process.env.JSON_DB_FILE ||
        path.join(__dirname, '../data/db.json')
      )
);

const EMPTY_STATE = () => ({
  berita: [],
  users: [],
  pengaturan: {}
});

// ======================================================
// 3. JSON STORAGE
// ======================================================

function jsonLoad() {
  if (!fs.existsSync(file)) {
    return EMPTY_STATE();
  }

  const content = fs.readFileSync(file, 'utf8');

  if (!content.trim()) {
    return EMPTY_STATE();
  }

  const data = JSON.parse(content);

  return {
    berita: Array.isArray(data.berita) ? data.berita : [],
    users: Array.isArray(data.users) ? data.users : [],
    pengaturan:
      data.pengaturan &&
      typeof data.pengaturan === 'object' &&
      !Array.isArray(data.pengaturan)
        ? data.pengaturan
        : {}
  };
}

function save() {
  const directory = path.dirname(file);

  fs.mkdirSync(directory, {
    recursive: true
  });

  const tempFile = `${file}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(
      tempFile,
      JSON.stringify(state, null, 2),
      {
        encoding: 'utf8',
        mode: 0o600
      }
    );

    fs.renameSync(tempFile, file);

  } catch (error) {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (_) {
      // Abaikan error pembersihan file sementara.
    }

    throw error;
  }
}

// JSON hanya diinisialisasi ketika mode JSON aktif.
if (mode === 'json') {
  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });
}

let state = mode === 'json' ? jsonLoad() : null;

// ======================================================
// 4. MYSQL CONNECTION
// ======================================================

if (mode === 'mysql') {

  // Jangan gunakan localhost untuk koneksi Vercel.
  if (
    isVercel &&
    (
      !process.env.DB_HOST ||
      !process.env.DB_USER ||
      !process.env.DB_NAME ||
      !process.env.DB_PASSWORD
    )
  ) {
    throw new Error(
      'Konfigurasi MySQL Vercel belum lengkap. Periksa DB_HOST, DB_USER, DB_PASSWORD dan DB_NAME.'
    );
  }

  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',

    port: Number(process.env.DB_PORT || 3306),

    user: process.env.DB_USER || 'root',

    password: process.env.DB_PASSWORD || '',

    database: process.env.DB_NAME || 'mediacenter_demo',

    waitForConnections: true,

    connectionLimit: isVercel ? 1 : 10,

    queueLimit: 0,

    dateStrings: true,

    timezone: '+08:00',

    charset: 'utf8mb4',

    ssl: process.env.DB_SSL === 'true'
      ? {
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true
        }
      : undefined
  });

} else if (mode !== 'json') {

  throw new Error(
    'DB_MODE harus json atau mysql'
  );

}

// ======================================================
// 5. DATABASE HELPERS
// ======================================================

async function rows(sql, params = []) {
  if (!pool) {
    throw new Error('Koneksi MySQL belum tersedia.');
  }

  const [result] = await pool.execute(sql, params);

  return result;
}

const normalize = value =>
  String(value || '').toLocaleLowerCase('id-ID');

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

// ======================================================
// 6. NEWS FILTER
// ======================================================

function filterNews(items, filters = {}) {
  let list = items.filter(item => {

    if (
      filters.q &&
      ![
        item.judul,
        item.kategori,
        item.penulis
      ].some(value =>
        normalize(value).includes(normalize(filters.q))
      )
    ) {
      return false;
    }

    if (
      filters.kategori &&
      item.kategori !== filters.kategori
    ) {
      return false;
    }

    if (
      filters.tahun &&
      String(item.tanggal).slice(0, 4) !==
        String(filters.tahun)
    ) {
      return false;
    }

    return true;
  });

  return list.sort((a, b) => {

    const order =
      String(a.tanggal).localeCompare(String(b.tanggal)) ||
      safeNumber(a.id) - safeNumber(b.id);

    return filters.urut === 'terlama'
      ? order
      : -order;

  });
}

// ======================================================
// 7. NEWS LIST
// ======================================================

async function listNews(filters = {}) {

  const page = Math.max(
    1,
    Math.floor(safeNumber(filters.page, 1))
  );

  const limit = Math.min(
    100,
    Math.max(
      1,
      Math.floor(safeNumber(filters.limit, 9))
    )
  );

  const offset = (page - 1) * limit;

  if (mode === 'json') {

    const found = filterNews(state.berita, filters);

    return {
      rows: found.slice(offset, offset + limit),
      total: found.length
    };

  }

  let sql = ' FROM berita WHERE 1=1';

  const params = [];

  if (filters.q) {

    sql += `
      AND (
        judul LIKE ?
        OR kategori LIKE ?
        OR penulis LIKE ?
      )
    `;

    const pattern = `%${filters.q}%`;

    params.push(
      pattern,
      pattern,
      pattern
    );

  }

  if (filters.kategori) {
    sql += ' AND kategori = ?';
    params.push(filters.kategori);
  }

  if (filters.tahun) {
    sql += ' AND YEAR(tanggal) = ?';
    params.push(Number(filters.tahun));
  }

  const count = await rows(
    'SELECT COUNT(*) AS total' + sql,
    params
  );

  const order = filters.urut === 'terlama'
    ? 'ASC'
    : 'DESC';

  const found = await rows(
    `SELECT
      id, judul, slug, isi, gambar,
      kategori, tanggal, penulis,
      sumber, updated_at
     ${sql}
     ORDER BY tanggal ${order}, id ${order}
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return {
    rows: found,
    total: Number(count[0].total)
  };

}

// ======================================================
// 8. LATEST NEWS
// ======================================================

async function latestNews(limit = 7) {

  const safeLimit = Math.min(
    100,
    Math.max(1, Math.floor(safeNumber(limit, 7)))
  );

  if (mode === 'json') {
    return filterNews(state.berita).slice(0, safeLimit);
  }

  return rows(
    `SELECT *
     FROM berita
     ORDER BY tanggal DESC, id DESC
     LIMIT ${safeLimit}`
  );

}

// ======================================================
// 9. FIND NEWS
// ======================================================

async function getById(id) {

  const numericId = Number(id);

  if (mode === 'json') {
    return state.berita.find(
      item => item.id === numericId
    ) || null;
  }

  const result = await rows(
    'SELECT * FROM berita WHERE id = ? LIMIT 1',
    [numericId]
  );

  return result[0] || null;

}

async function getBySlug(slug) {

  if (mode === 'json') {
    return state.berita.find(
      item => item.slug === slug
    ) || null;
  }

  const result = await rows(
    'SELECT * FROM berita WHERE slug = ? LIMIT 1',
    [slug]
  );

  return result[0] || null;

}

// ======================================================
// 10. UNIQUE SLUG
// ======================================================

async function uniqueSlug(title, ignoreId = 0) {

  const { slugify } = require('./helpers');

  const base = slugify(title);

  let slug = base;
  let counter = 2;

  for (;;) {

    const exists = mode === 'json'

      ? state.berita.some(item =>
          item.slug === slug &&
          item.id !== Number(ignoreId)
        )

      : (
          await rows(
            `SELECT id
             FROM berita
             WHERE slug = ? AND id != ?
             LIMIT 1`,
            [slug, ignoreId]
          )
        ).length > 0;

    if (!exists) {
      return slug;
    }

    slug = `${base}-${counter++}`;

  }

}

// ======================================================
// 11. CREATE NEWS
// ======================================================

async function createNews(data) {

  const slug = await uniqueSlug(data.judul);

  if (mode === 'json') {

    const id = state.berita.reduce(
      (max, item) => Math.max(max, safeNumber(item.id)),
      0
    ) + 1;

    const now = new Date().toISOString();

    state.berita.push({
      id,
      slug,
      ...data,
      created_at: now,
      updated_at: now
    });

    save();

    return id;

  }

  const [result] = await pool.execute(
    `INSERT INTO berita
      (judul, slug, isi, gambar, kategori,
       tanggal, penulis, sumber)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.judul,
      slug,
      data.isi,
      data.gambar || null,
      data.kategori,
      data.tanggal,
      data.penulis,
      data.sumber
    ]
  );

  return result.insertId;

}

// ======================================================
// 12. UPDATE NEWS
// ======================================================

async function updateNews(id, data) {

  const slug = await uniqueSlug(data.judul, id);

  if (mode === 'json') {

    const item = state.berita.find(
      row => row.id === Number(id)
    );

    if (!item) {
      return false;
    }

    Object.assign(item, data, {
      slug,
      updated_at: new Date().toISOString()
    });

    save();

    return true;

  }

  await rows(
    `UPDATE berita SET
      judul = ?,
      slug = ?,
      isi = ?,
      gambar = ?,
      kategori = ?,
      tanggal = ?,
      penulis = ?,
      sumber = ?
     WHERE id = ?`,
    [
      data.judul,
      slug,
      data.isi,
      data.gambar || null,
      data.kategori,
      data.tanggal,
      data.penulis,
      data.sumber,
      id
    ]
  );

  return true;

}

// ======================================================
// 13. DELETE NEWS
// ======================================================

async function deleteNews(id) {

  if (mode === 'json') {

    const previousLength = state.berita.length;

    state.berita = state.berita.filter(
      item => item.id !== Number(id)
    );

    if (previousLength !== state.berita.length) {
      save();
      return true;
    }

    return false;

  }

  await rows(
    'DELETE FROM berita WHERE id = ?',
    [Number(id)]
  );

  return true;

}

// ======================================================
// 14. CATEGORIES
// ======================================================

async function categories() {

  if (mode === 'json') {

    return [
      ...new Set(
        state.berita
          .map(item => item.kategori)
          .filter(Boolean)
      )
    ].sort();

  }

  const result = await rows(
    `SELECT DISTINCT kategori
     FROM berita
     WHERE kategori IS NOT NULL
       AND kategori != ''
     ORDER BY kategori`
  );

  return result.map(item => item.kategori);

}

// ======================================================
// 15. YEARS
// ======================================================

async function years() {

  if (mode === 'json') {

    return [
      ...new Set(
        state.berita
          .map(item =>
            Number(String(item.tanggal).slice(0, 4))
          )
          .filter(Boolean)
      )
    ].sort((a, b) => b - a);

  }

  const result = await rows(
    `SELECT DISTINCT YEAR(tanggal) AS y
     FROM berita
     ORDER BY y DESC`
  );

  return result.map(item => Number(item.y));

}

// ======================================================
// 16. STATISTICS
// ======================================================

async function stats() {

  if (mode === 'json') {

    const all = state.berita;

    const latest = all
      .slice()
      .sort((a, b) =>
        String(b.updated_at).localeCompare(
          String(a.updated_at)
        )
      )[0];

    return {
      totalBerita: all.length,

      totalKategori: new Set(
        all.map(item => item.kategori).filter(Boolean)
      ).size,

      totalGambar: all.filter(
        item => item.gambar
      ).length,

      latest: latest?.updated_at || null
    };

  }

  const result = await rows(
    `SELECT
      COUNT(*) AS totalBerita,
      COUNT(DISTINCT kategori) AS totalKategori,
      COUNT(NULLIF(gambar, '')) AS totalGambar,
      MAX(updated_at) AS latest
     FROM berita`
  );

  return result[0];

}

// ======================================================
// 17. ACTIVITY
// ======================================================

async function activity() {

  const last = [];

  for (let i = 6; i >= 0; i--) {

    const date = new Date();

    date.setUTCHours(12, 0, 0, 0);

    date.setUTCDate(
      date.getUTCDate() - i
    );

    last.push({
      date: date.toISOString().slice(0, 10),
      count: 0
    });

  }

  const values = mode === 'json'

    ? state.berita.map(item => ({
        date: String(item.tanggal).slice(0, 10)
      }))

    : await rows(
        `SELECT DATE_FORMAT(tanggal, '%Y-%m-%d') AS date
         FROM berita
         WHERE tanggal >= DATE_SUB(
           CURDATE(),
           INTERVAL 6 DAY
         )`
      );

  for (const value of values) {

    const item = last.find(
      row => row.date === value.date
    );

    if (item) {
      item.count++;
    }

  }

  return last;

}

// ======================================================
// 18. SETTINGS
// ======================================================

async function getSettings() {

  if (mode === 'json') {
    return {
      ...defaultSettings,
      ...state.pengaturan
    };
  }

  const result = await rows(
    'SELECT kunci, nilai FROM pengaturan'
  );

  return {
    ...defaultSettings,
    ...Object.fromEntries(
      result.map(item => [
        item.kunci,
        item.nilai
      ])
    )
  };

}

async function saveSettings(fields) {

  if (mode === 'json') {

    state.pengaturan = {
      ...state.pengaturan,
      ...fields
    };

    save();

    return;

  }

  for (const [key, value] of Object.entries(fields)) {

    await rows(
      `INSERT INTO pengaturan (kunci, nilai)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
       nilai = VALUES(nilai)`,
      [key, value]
    );

  }

}

// ======================================================
// 19. USERS
// ======================================================

async function getUser(username) {

  if (mode === 'json') {

    return state.users.find(
      user => user.username === username
    ) || null;

  }

  const result = await rows(
    `SELECT id, username, password
     FROM users
     WHERE username = ?
     LIMIT 1`,
    [username]
  );

  return result[0] || null;

}

async function createUser(username, hash) {

  if (mode === 'json') {

    if (
      state.users.some(
        user => user.username === username
      )
    ) {
      throw new Error('Username sudah digunakan');
    }

    const id = state.users.reduce(
      (max, user) => Math.max(max, safeNumber(user.id)),
      0
    ) + 1;

    state.users.push({
      id,
      username,
      password: hash
    });

    save();

    return id;

  }

  const [result] = await pool.execute(
    'INSERT INTO users (username, password) VALUES (?, ?)',
    [username, hash]
  );

  return result.insertId;

}

// ======================================================
// 20. EXPORT MODULE
// ======================================================

module.exports = {
  mode,

  listNews,
  latestNews,

  getById,
  getBySlug,
  uniqueSlug,

  createNews,
  updateNews,
  deleteNews,

  categories,
  years,
  stats,
  activity,

  getSettings,
  saveSettings,

  getUser,
  createUser
};
