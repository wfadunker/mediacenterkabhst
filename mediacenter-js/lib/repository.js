'use strict';

// ============================================================
// DEPENDENCIES
// ============================================================

try {
  require('dotenv').config();
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { defaultSettings } = require('./helpers');

// ============================================================
// CONFIGURATION
// ============================================================

const isVercel = process.env.VERCEL === '1';
const mode = String(process.env.DB_MODE || (isVercel ? 'mysql' : 'json'))
  .trim()
  .toLowerCase();

const jsonFile = path.resolve(
  process.env.JSON_DB_FILE ||
  (isVercel
    ? '/tmp/mediacenter-hst/db.json'
    : path.join(__dirname, '../data/db.json'))
);

const emptyState = () => ({
  berita: [],
  users: [],
  pengaturan: {}
});

let pool = null;
let state = null;

// ============================================================
// HELPERS
// ============================================================

const normalize = value =>
  String(value ?? '').toLocaleLowerCase('id-ID');

function positiveInteger(value, fallback, maximum = 100) {
  const number = Math.floor(Number(value));

  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }

  return Math.min(number, maximum);
}

function getSslConfig() {
  const rawCa = process.env.DB_SSL_CA;
  const ca = rawCa
    ? rawCa.replace(/\\n/g, '\n').trim()
    : '';

  if (isVercel && !ca) {
    throw new Error(
      'DB_SSL_CA belum diatur. Masukkan isi sertifikat CA TiDB Cloud pada Environment Variables Vercel.'
    );
  }

  if (ca) {
    return {
      ca,
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    };
  }

  if (process.env.DB_SSL === 'true') {
    return {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    };
  }

  return undefined;
}

// ============================================================
// JSON STORAGE (LOCAL DEVELOPMENT)
// ============================================================

function jsonLoad() {
  if (!fs.existsSync(jsonFile)) {
    return emptyState();
  }

  const content = fs.readFileSync(jsonFile, 'utf8');

  if (!content.trim()) {
    return emptyState();
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
  const directory = path.dirname(jsonFile);
  const temporaryFile = `${jsonFile}.${process.pid}.tmp`;

  fs.mkdirSync(directory, { recursive: true });

  try {
    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(state, null, 2),
      'utf8'
    );

    fs.renameSync(temporaryFile, jsonFile);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryFile)) {
        fs.unlinkSync(temporaryFile);
      }
    } catch (_) {
      // Ignore cleanup errors.
    }

    throw error;
  }
}

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

if (mode === 'json') {
  if (isVercel) {
    throw new Error(
      'Vercel harus menggunakan DB_MODE=mysql. Penyimpanan JSON di Vercel tidak persisten.'
    );
  }

  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  state = jsonLoad();

} else if (mode === 'mysql') {

  const required = [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME'
  ];

  const missing = required.filter(
    key => !String(process.env[key] || '').trim()
  );

  if (missing.length) {
    throw new Error(
      `Konfigurasi MySQL belum lengkap: ${missing.join(', ')}`
    );
  }

  const port = Number(
    process.env.DB_PORT || (isVercel ? 4000 : 3306)
  );

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT tidak valid.');
  }

  pool = mysql.createPool({
    host: process.env.DB_HOST.trim(),
    port,

    user: process.env.DB_USER.trim(),
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME.trim(),

    waitForConnections: true,

    connectionLimit: positiveInteger(
      process.env.DB_CONNECTION_LIMIT,
      isVercel ? 5 : 10,
      20
    ),

    queueLimit: 0,

    connectTimeout: 15000,

    enableKeepAlive: true,
    keepAliveInitialDelay: 0,

    dateStrings: true,
    timezone: '+08:00',
    charset: 'utf8mb4',

    ssl: getSslConfig()
  });

} else {
  throw new Error('DB_MODE harus bernilai json atau mysql.');
}

// ============================================================
// QUERY HELPERS
// ============================================================

async function rows(sql, params = []) {
  if (!pool) {
    throw new Error('Koneksi MySQL belum tersedia.');
  }

  const [result] = await pool.execute(sql, params);

  return result;
}

async function testConnection() {
  if (mode === 'json') {
    return {
      ok: true,
      mode: 'json'
    };
  }

  await rows('SELECT 1 AS connection_test');

  return {
    ok: true,
    mode: 'mysql',
    database: process.env.DB_NAME
  };
}

// ============================================================
// NEWS FILTER AND LIST
// ============================================================

function filterNews(items, filters = {}) {
  const list = items.filter(item => {

    if (
      filters.q &&
      ![item.judul, item.kategori, item.penulis].some(value =>
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
      String(item.tanggal).slice(0, 4) !== String(filters.tahun)
    ) {
      return false;
    }

    return true;
  });

  return list.sort((a, b) => {
    const order =
      String(a.tanggal).localeCompare(String(b.tanggal)) ||
      Number(a.id || 0) - Number(b.id || 0);

    return filters.urut === 'terlama' ? order : -order;
  });
}

async function listNews(filters = {}) {
  const page = positiveInteger(filters.page, 1, 1000000);
  const limit = positiveInteger(filters.limit, 9, 100);
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

    const pattern = `%${String(filters.q)}%`;

    params.push(pattern, pattern, pattern);
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
    `SELECT COUNT(*) AS total ${sql}`,
    params
  );

  const order = filters.urut === 'terlama' ? 'ASC' : 'DESC';

  const found = await rows(
    `SELECT
      id, judul, slug, isi, gambar,
      kategori, tanggal, penulis, sumber, updated_at
     ${sql}
     ORDER BY tanggal ${order}, id ${order}
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return {
    rows: found,
    total: Number(count[0]?.total || 0)
  };
}

// ============================================================
// LATEST NEWS
// ============================================================

async function latestNews(limit = 7) {
  const safeLimit = positiveInteger(limit, 7, 100);

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

// ============================================================
// GET NEWS
// ============================================================

async function getById(id) {
  const numericId = Number(id);

  if (!Number.isFinite(numericId)) {
    return null;
  }

  if (mode === 'json') {
    return state.berita.find(
      item => Number(item.id) === numericId
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

// ============================================================
// SLUG GENERATOR
// ============================================================

async function uniqueSlug(title, ignoreId = 0) {
  const { slugify } = require('./helpers');

  const base = slugify(title);

  let slug = base;
  let counter = 2;

  for (;;) {
    const exists = mode === 'json'
      ? state.berita.some(item =>
          item.slug === slug &&
          Number(item.id) !== Number(ignoreId)
        )
      : (
          await rows(
            `SELECT id
             FROM berita
             WHERE slug = ? AND id != ?
             LIMIT 1`,
            [slug, Number(ignoreId)]
          )
        ).length > 0;

    if (!exists) {
      return slug;
    }

    slug = `${base}-${counter++}`;
  }
}

// ============================================================
// CREATE NEWS
// ============================================================

async function createNews(data) {
  const slug = await uniqueSlug(data.judul);

  if (mode === 'json') {
    const id = state.berita.reduce(
      (max, item) => Math.max(max, Number(item.id) || 0),
      0
    ) + 1;

    const now = new Date().toISOString();

    state.berita.push({
      ...data,
      id,
      slug,
      created_at: now,
      updated_at: now
    });

    save();

    return id;
  }

  const [result] = await pool.execute(
    `INSERT INTO berita
      (judul, slug, isi, gambar, kategori, tanggal, penulis, sumber)
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

// ============================================================
// UPDATE NEWS
// ============================================================

async function updateNews(id, data) {
  const numericId = Number(id);

  if (!Number.isFinite(numericId)) {
    return false;
  }

  const slug = await uniqueSlug(data.judul, numericId);

  if (mode === 'json') {
    const item = state.berita.find(
      row => Number(row.id) === numericId
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
      numericId
    ]
  );

  return true;
}

// ============================================================
// DELETE NEWS
// ============================================================

async function deleteNews(id) {
  const numericId = Number(id);

  if (!Number.isFinite(numericId)) {
    return false;
  }

  if (mode === 'json') {
    const previousLength = state.berita.length;

    state.berita = state.berita.filter(
      item => Number(item.id) !== numericId
    );

    if (previousLength === state.berita.length) {
      return false;
    }

    save();

    return true;
  }

  await rows(
    'DELETE FROM berita WHERE id = ?',
    [numericId]
  );

  return true;
}

// ============================================================
// CATEGORIES AND YEARS
// ============================================================

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

async function years() {
  if (mode === 'json') {
    return [
      ...new Set(
        state.berita
          .map(item => Number(String(item.tanggal).slice(0, 4)))
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

// ============================================================
// STATISTICS
// ============================================================

async function stats() {
  if (mode === 'json') {
    const all = state.berita;

    const latest = all
      .slice()
      .sort((a, b) =>
        String(b.updated_at).localeCompare(String(a.updated_at))
      )[0];

    return {
      totalBerita: all.length,

      totalKategori: new Set(
        all.map(item => item.kategori).filter(Boolean)
      ).size,

      totalGambar: all.filter(item => item.gambar).length,

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

// ============================================================
// NEWS ACTIVITY (LAST 7 DAYS)
// ============================================================

async function activity() {
  const last = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();

    date.setUTCHours(12, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - i);

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
         WHERE tanggal >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)`
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

// ============================================================
// SETTINGS
// ============================================================

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
      result.map(item => [item.kunci, item.nilai])
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
       ON DUPLICATE KEY UPDATE nilai = VALUES(nilai)`,
      [key, value]
    );
  }
}

// ============================================================
// USERS
// ============================================================

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
      state.users.some(user => user.username === username)
    ) {
      throw new Error('Username sudah digunakan');
    }

    const id = state.users.reduce(
      (max, user) => Math.max(max, Number(user.id) || 0),
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
    `INSERT INTO users (username, password)
     VALUES (?, ?)`,
    [username, hash]
  );

  return result.insertId;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  mode,
  testConnection,

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