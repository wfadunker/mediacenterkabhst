'use strict';

// ============================================================
// MEDIA CENTER HST - DATABASE REPOSITORY
// Optimized for Laragon, MySQL and TiDB Cloud
// ============================================================

// ============================================================
// 1. DEPENDENCIES
// ============================================================

try {
  require('dotenv').config();
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const {
  defaultSettings,
  slugify
} = require('./helpers');

// ============================================================
// 2. CONFIGURATION
// ============================================================

const isVercel = process.env.VERCEL === '1';

const mode = String(
  process.env.DB_MODE || (isVercel ? 'mysql' : 'json')
).trim().toLowerCase();

const jsonFile = path.resolve(
  process.env.JSON_DB_FILE ||
  (
    isVercel
      ? '/tmp/mediacenter-hst/db.json'
      : path.join(__dirname, '../data/db.json')
  )
);

const emptyState = () => ({
  berita: [],
  users: [],
  pengaturan: {}
});

let pool = null;
let state = null;

// ============================================================
// 3. GENERAL HELPERS
// ============================================================

const normalize = value =>
  String(value ?? '').toLocaleLowerCase('id-ID');

function positiveInteger(value, fallback = 1, maximum = 100) {
  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    return fallback;
  }

  return Math.min(number, maximum);
}

function validId(value) {
  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0
    ? id
    : null;
}

function validYear(value) {
  const year = Number(value);

  return Number.isInteger(year) &&
    year >= 1900 &&
    year <= 9999
      ? year
      : null;
}

function validObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function getLocalDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(item => [item.type, item.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(dateString, days) {
  const [year, month, day] = dateString
    .split('-')
    .map(Number);

  const date = new Date(
    Date.UTC(year, month - 1, day + days)
  );

  return date.toISOString().slice(0, 10);
}

// ============================================================
// 4. MYSQL SSL CONFIGURATION
// ============================================================

function getSslConfig() {
  const raw = String(
    process.env.DB_SSL_CA || ''
  );

  const ca = raw
    .replace(/\\r?\\n/g, '\n')
    .trim();

  if (isVercel && !ca.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(
      'DB_SSL_CA tidak valid. Masukkan isi sertifikat CA TiDB Cloud.'
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
// 5. JSON STORAGE
// ============================================================

function jsonLoad() {
  if (!fs.existsSync(jsonFile)) {
    return emptyState();
  }

  const content = fs.readFileSync(
    jsonFile,
    'utf8'
  );

  if (!content.trim()) {
    return emptyState();
  }

  let data;

  try {
    data = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Database JSON tidak valid: ${error.message}`
    );
  }

  if (!validObject(data)) {
    return emptyState();
  }

  return {
    berita: Array.isArray(data.berita)
      ? data.berita
      : [],

    users: Array.isArray(data.users)
      ? data.users
      : [],

    pengaturan: validObject(data.pengaturan)
      ? data.pengaturan
      : {}
  };
}

function save() {
  if (!state) {
    throw new Error('Database JSON belum diinisialisasi.');
  }

  const directory = path.dirname(jsonFile);

  const temporaryFile =
    `${jsonFile}.${process.pid}.tmp`;

  fs.mkdirSync(directory, {
    recursive: true
  });

  try {
    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(state, null, 2),
      'utf8'
    );

    fs.renameSync(
      temporaryFile,
      jsonFile
    );
  } catch (error) {
    try {
      if (fs.existsSync(temporaryFile)) {
        fs.unlinkSync(temporaryFile);
      }
    } catch {
      // Abaikan kesalahan pembersihan.
    }

    throw error;
  }
}

// ============================================================
// 6. DATABASE INITIALIZATION
// ============================================================

if (mode === 'json') {
  if (isVercel) {
    throw new Error(
      'Vercel harus menggunakan DB_MODE=mysql. JSON tidak persisten.'
    );
  }

  fs.mkdirSync(
    path.dirname(jsonFile),
    { recursive: true }
  );

  state = jsonLoad();

} else if (mode === 'mysql') {

  const required = [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME'
  ];

  const missing = required.filter(key =>
    !String(process.env[key] || '').trim()
  );

  if (missing.length) {
    throw new Error(
      `Konfigurasi database belum lengkap: ${missing.join(', ')}`
    );
  }

  const port = Number(
    process.env.DB_PORT || (isVercel ? 4000 : 3306)
  );

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
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

    maxIdle: isVercel ? 2 : 5,
    idleTimeout: 60000,
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
  throw new Error(
    'DB_MODE harus bernilai json atau mysql.'
  );
}

// ============================================================
// 7. DATABASE QUERY HELPERS
// ============================================================

async function rows(sql, params = []) {
  if (!pool) {
    throw new Error(
      'Koneksi MySQL belum tersedia.'
    );
  }

  const [result] = await pool.execute(
    sql,
    params
  );

  return result;
}

async function testConnection() {
  if (mode === 'json') {
    return {
      ok: true,
      mode: 'json'
    };
  }

  const result = await rows(
    'SELECT DATABASE() AS database_name'
  );

  return {
    ok: true,
    mode: 'mysql',
    database: result[0]?.database_name || null
  };
}

// ============================================================
// 8. NEWS FILTER
// ============================================================

function filterNews(items, filters = {}) {
  const q = normalize(filters.q || '');
  const kategori = String(filters.kategori || '');
  const tahun = validYear(filters.tahun);

  const list = items.filter(item => {
    if (
      q &&
      ![
        item.judul,
        item.kategori,
        item.penulis
      ].some(value =>
        normalize(value).includes(q)
      )
    ) {
      return false;
    }

    if (
      kategori &&
      item.kategori !== kategori
    ) {
      return false;
    }

    if (
      tahun &&
      String(item.tanggal).slice(0, 4) !== String(tahun)
    ) {
      return false;
    }

    return true;
  });

  list.sort((a, b) => {
    const order =
      String(a.tanggal || '').localeCompare(
        String(b.tanggal || '')
      ) ||
      Number(a.id || 0) - Number(b.id || 0);

    return filters.urut === 'terlama'
      ? order
      : -order;
  });

  return list;
}

// ============================================================
// 9. LIST NEWS
// ============================================================

async function listNews(filters = {}) {
  const page = positiveInteger(
    filters.page,
    1,
    1000000
  );

  const limit = positiveInteger(
    filters.limit,
    9,
    100
  );

  const offset = (page - 1) * limit;

  if (mode === 'json') {
    const found = filterNews(
      state.berita,
      filters
    );

    return {
      rows: found.slice(offset, offset + limit),
      total: found.length
    };
  }

  let where = ' WHERE 1=1';
  const params = [];

  const q = String(filters.q || '').trim();

  if (q) {
    where += `
      AND (
        judul LIKE ?
        OR kategori LIKE ?
        OR penulis LIKE ?
      )
    `;

    const pattern = `%${q}%`;

    params.push(
      pattern,
      pattern,
      pattern
    );
  }

  const kategori = String(
    filters.kategori || ''
  ).trim();

  if (kategori) {
    where += ' AND kategori = ?';
    params.push(kategori);
  }

  const tahun = validYear(filters.tahun);

  if (tahun) {
    where += ' AND tanggal >= ? AND tanggal < ?';

    params.push(
      `${tahun}-01-01`,
      `${tahun + 1}-01-01`
    );
  }

  const order =
    filters.urut === 'terlama'
      ? 'ASC'
      : 'DESC';

  const [count, found] = await Promise.all([
    rows(
      `SELECT COUNT(*) AS total
       FROM berita
       ${where}`,
      params
    ),

    rows(
      `SELECT
        id,
        judul,
        slug,
        isi,
        gambar,
        kategori,
        tanggal,
        penulis,
        sumber,
        updated_at
       FROM berita
       ${where}
       ORDER BY tanggal ${order}, id ${order}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
  ]);

  return {
    rows: found,
    total: Number(count[0]?.total || 0)
  };
}

// ============================================================
// 10. LATEST NEWS
// ============================================================

async function latestNews(limit = 7) {
  const safeLimit = positiveInteger(
    limit,
    7,
    100
  );

  if (mode === 'json') {
    return filterNews(
      state.berita
    ).slice(0, safeLimit);
  }

  return rows(
    `SELECT *
     FROM berita
     ORDER BY tanggal DESC, id DESC
     LIMIT ?`,
    [safeLimit]
  );
}

// ============================================================
// 11. GET NEWS BY ID
// ============================================================

async function getById(id) {
  const numericId = validId(id);

  if (!numericId) return null;

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

// ============================================================
// 12. GET NEWS BY SLUG
// ============================================================

async function getBySlug(slug) {
  const value = String(slug || '').trim();

  if (!value) return null;

  if (mode === 'json') {
    return state.berita.find(
      item => item.slug === value
    ) || null;
  }

  const result = await rows(
    'SELECT * FROM berita WHERE slug = ? LIMIT 1',
    [value]
  );

  return result[0] || null;
}

// ============================================================
// 13. UNIQUE SLUG
// ============================================================

async function uniqueSlug(title, ignoreId = 0) {
  const base = String(
    slugify(String(title || ''))
  ).slice(0, 230) || 'berita';

  const ignoredId = Number(ignoreId) || 0;

  let slug = base;
  let counter = 2;

  while (true) {
    let exists = false;

    if (mode === 'json') {
      exists = state.berita.some(item =>
        item.slug === slug &&
        Number(item.id) !== ignoredId
      );
    } else {
      const result = await rows(
        `SELECT id
         FROM berita
         WHERE slug = ?
           AND id <> ?
         LIMIT 1`,
        [slug, ignoredId]
      );

      exists = result.length > 0;
    }

    if (!exists) {
      return slug;
    }

    slug = `${base}-${counter++}`;
  }
}

// ============================================================
// 14. CREATE NEWS
// ============================================================

async function createNews(data) {
  if (!validObject(data)) {
    throw new Error('Data berita tidak valid.');
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await uniqueSlug(data.judul);

    if (mode === 'json') {
      const id = state.berita.reduce(
        (max, item) =>
          Math.max(max, Number(item.id) || 0),
        0
      ) + 1;

      const now = new Date().toISOString();

      const record = {
        ...data,
        id,
        slug,
        created_at: now,
        updated_at: now
      };

      state.berita.push(record);

      try {
        save();
      } catch (error) {
        state.berita.pop();
        throw error;
      }

      return id;
    }

    try {
      const [result] = await pool.execute(
        `INSERT INTO berita
          (
            judul,
            slug,
            isi,
            gambar,
            kategori,
            tanggal,
            penulis,
            sumber
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.judul,
          slug,
          data.isi,
          data.gambar || null,
          data.kategori,
          data.tanggal,
          data.penulis || '',
          data.sumber || ''
        ]
      );

      return result.insertId;

    } catch (error) {
      if (
        error.code === 'ER_DUP_ENTRY' &&
        attempt < 4
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    'Gagal membuat slug berita yang unik.'
  );
}

// ============================================================
// 15. UPDATE NEWS
// ============================================================

async function updateNews(id, data) {
  const numericId = validId(id);

  if (!numericId || !validObject(data)) {
    return false;
  }

  if (mode === 'json') {
    const item = state.berita.find(
      row => Number(row.id) === numericId
    );

    if (!item) return false;

    const previous = { ...item };

    const slug = await uniqueSlug(
      data.judul,
      numericId
    );

    Object.assign(item, data, {
      slug,
      updated_at: new Date().toISOString()
    });

    try {
      save();
    } catch (error) {
      Object.assign(item, previous);
      throw error;
    }

    return true;
  }

  const existing = await getById(numericId);

  if (!existing) return false;

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await uniqueSlug(
      data.judul,
      numericId
    );

    try {
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
          data.penulis || '',
          data.sumber || '',
          numericId
        ]
      );

      return true;

    } catch (error) {
      if (
        error.code === 'ER_DUP_ENTRY' &&
        attempt < 4
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    'Gagal memperbarui slug berita.'
  );
}

// ============================================================
// 16. DELETE NEWS
// ============================================================

async function deleteNews(id) {
  const numericId = validId(id);

  if (!numericId) return false;

  if (mode === 'json') {
    const previous = state.berita;

    const filtered = previous.filter(
      item => Number(item.id) !== numericId
    );

    if (filtered.length === previous.length) {
      return false;
    }

    state.berita = filtered;

    try {
      save();
    } catch (error) {
      state.berita = previous;
      throw error;
    }

    return true;
  }

  const result = await rows(
    'DELETE FROM berita WHERE id = ?',
    [numericId]
  );

  return result.affectedRows > 0;
}

// ============================================================
// 17. CATEGORIES
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

// ============================================================
// 18. YEARS
// ============================================================

async function years() {
  if (mode === 'json') {
    return [
      ...new Set(
        state.berita
          .map(item =>
            Number(String(item.tanggal).slice(0, 4))
          )
          .filter(validYear)
      )
    ].sort((a, b) => b - a);
  }

  const result = await rows(
    `SELECT DISTINCT YEAR(tanggal) AS y
     FROM berita
     WHERE tanggal IS NOT NULL
     ORDER BY y DESC`
  );

  return result
    .map(item => Number(item.y))
    .filter(validYear);
}

// ============================================================
// 19. STATISTICS
// ============================================================

async function stats() {
  if (mode === 'json') {
    const all = state.berita;

    const latest = all
      .slice()
      .sort((a, b) =>
        String(b.updated_at || '').localeCompare(
          String(a.updated_at || '')
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

  const data = result[0] || {};

  return {
    totalBerita: Number(data.totalBerita || 0),
    totalKategori: Number(data.totalKategori || 0),
    totalGambar: Number(data.totalGambar || 0),
    latest: data.latest || null
  };
}

// ============================================================
// 20. NEWS ACTIVITY - LAST 7 DAYS
// ============================================================

async function activity() {
  const today = getLocalDate();
  const startDate = shiftDate(today, -6);
  const endDate = shiftDate(today, 1);

  const result = [];

  for (let i = 0; i < 7; i++) {
    result.push({
      date: shiftDate(startDate, i),
      count: 0
    });
  }

  let values = [];

  if (mode === 'json') {
    const counts = new Map();

    for (const item of state.berita) {
      const date = String(
        item.tanggal || ''
      ).slice(0, 10);

      if (
        date >= startDate &&
        date < endDate
      ) {
        counts.set(
          date,
          (counts.get(date) || 0) + 1
        );
      }
    }

    values = Array.from(
      counts,
      ([date, count]) => ({ date, count })
    );

  } else {
    values = await rows(
      `SELECT
        DATE_FORMAT(tanggal, '%Y-%m-%d') AS date,
        COUNT(*) AS count
       FROM berita
       WHERE tanggal >= ?
         AND tanggal < ?
       GROUP BY DATE(tanggal)`,
      [
        startDate,
        endDate
      ]
    );
  }

  const countMap = new Map(
    values.map(item => [
      String(item.date),
      Number(item.count) || 0
    ])
  );

  for (const item of result) {
    item.count = countMap.get(item.date) || 0;
  }

  return result;
}

// ============================================================
// 21. GET SETTINGS
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

  const settings = Object.fromEntries(
    result.map(item => [
      item.kunci,
      item.nilai
    ])
  );

  return {
    ...defaultSettings,
    ...settings
  };
}

// ============================================================
// 22. SAVE SETTINGS
// ============================================================

async function saveSettings(fields) {
  if (!validObject(fields)) {
    throw new Error('Pengaturan tidak valid.');
  }

  const entries = Object.entries(fields)
    .filter(([key]) =>
      typeof key === 'string' &&
      key.trim().length > 0 &&
      key.length <= 100
    )
    .map(([key, value]) => [
      key.trim(),
      value == null ? '' : String(value)
    ]);

  if (!entries.length) return;

  if (mode === 'json') {
    const previous = { ...state.pengaturan };

    state.pengaturan = {
      ...state.pengaturan,
      ...Object.fromEntries(entries)
    };

    try {
      save();
    } catch (error) {
      state.pengaturan = previous;
      throw error;
    }

    return;
  }

  const placeholders = entries
    .map(() => '(?, ?)')
    .join(', ');

  const params = entries.flat();

  await rows(
    `INSERT INTO pengaturan (kunci, nilai)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       nilai = VALUES(nilai)`,
    params
  );
}

// ============================================================
// 23. GET USER - ADMIN LOGIN
// ============================================================

async function getUser(username) {
  const name = String(
    username || ''
  ).trim();

  if (!name || name.length > 100) {
    return null;
  }

  if (mode === 'json') {
    const user = state.users.find(
      item => item.username === name
    );

    if (!user) return null;

    return {
      id: user.id,
      username: user.username,
      password: user.password
    };
  }

  const result = await rows(
    `SELECT
      id,
      username,
      password
     FROM users
     WHERE username = ?
     LIMIT 1`,
    [name]
  );

  if (!result.length) return null;

  const user = result[0];

  return {
    id: Number(user.id),
    username: user.username,
    password: user.password
  };
}

// ============================================================
// 24. CREATE USER
// ============================================================

async function createUser(username, hash) {
  const name = String(
    username || ''
  ).trim();

  const passwordHash = String(
    hash || ''
  ).trim();

  if (
    !name ||
    name.length > 100 ||
    !passwordHash
  ) {
    throw new Error('Data pengguna tidak valid.');
  }

  if (mode === 'json') {
    const exists = state.users.some(
      user => user.username === name
    );

    if (exists) {
      throw new Error('Username sudah digunakan.');
    }

    const id = state.users.reduce(
      (max, user) =>
        Math.max(max, Number(user.id) || 0),
      0
    ) + 1;

    state.users.push({
      id,
      username: name,
      password: passwordHash
    });

    try {
      save();
    } catch (error) {
      state.users.pop();
      throw error;
    }

    return id;
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO users
        (username, password)
       VALUES (?, ?)`,
      [
        name,
        passwordHash
      ]
    );

    return result.insertId;

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new Error('Username sudah digunakan.');
    }

    throw error;
  }
}

// ============================================================
// 25. UPDATE USER PASSWORD
// ============================================================

async function updateUserPassword(id, hash) {
  const numericId = validId(id);
  const passwordHash = String(hash || '').trim();

  if (!numericId || !passwordHash) {
    return false;
  }

  if (mode === 'json') {
    const user = state.users.find(
      item => Number(item.id) === numericId
    );

    if (!user) return false;

    const previous = user.password;

    user.password = passwordHash;

    try {
      save();
    } catch (error) {
      user.password = previous;
      throw error;
    }

    return true;
  }

  const result = await rows(
    `UPDATE users
     SET password = ?
     WHERE id = ?`,
    [
      passwordHash,
      numericId
    ]
  );

  if (result.affectedRows > 0) {
    return true;
  }

  // affectedRows dapat 0 jika hash yang disimpan sama.
  const existing = await getByUserId(numericId);

  return Boolean(existing);
}

async function getByUserId(id) {
  const numericId = validId(id);

  if (!numericId) return null;

  if (mode === 'json') {
    return state.users.find(
      item => Number(item.id) === numericId
    ) || null;
  }

  const result = await rows(
    `SELECT id, username
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [numericId]
  );

  return result[0] || null;
}

// ============================================================
// 26. DATABASE SHUTDOWN
// ============================================================

async function closePool() {
  if (!pool) return;

  await pool.end();
  pool = null;
}

// ============================================================
// 27. EXPORTS
// ============================================================

module.exports = {
  // Configuration
  mode,

  // Database
  testConnection,
  closePool,

  // News
  listNews,
  latestNews,
  getById,
  getBySlug,
  uniqueSlug,
  createNews,
  updateNews,
  deleteNews,

  // Categories
  categories,
  years,

  // Dashboard
  stats,
  activity,

  // Settings
  getSettings,
  saveSettings,

  // Users and authentication
  getUser,
  getByUserId,
  createUser,
  updateUserPassword
};