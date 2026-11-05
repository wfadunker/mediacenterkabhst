'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const store = require('./lib/repository');
const H = require('./lib/helpers');

const app = express();
const publicRouter = express.Router();
const adminRouter = express.Router();

const BASE = H.baseUrl;
const ADMIN = BASE + '/admin';

const PROD = process.env.NODE_ENV === 'production';
const IS_VERCEL = process.env.VERCEL === '1';
const PORT = Number(process.env.PORT || 3000);

const VERSION = '2026.11.05-hst-v6-optimized';

const ASSETS = path.join(__dirname, 'public', 'assets');
const UPLOAD_DIR = path.join(ASSETS, 'img', 'berita');
const PORTAL = 'https://www.hstkab.go.id/';

const MYSQL_ENABLED = store.mode === 'mysql';

const DUMMY_HASH =
  '$2a$10$NAWSEAGZrEoPpvNsG2qvC.BtGkDDGMuDDymd.dpb89ugwuCZbYPBO';

// =========================================================
// DATABASE SSL
// =========================================================

function getDatabaseSsl() {
  const ca = String(process.env.DB_SSL_CA || '')
    .replace(/\\n/g, '\n')
    .trim();

  if (IS_VERCEL && !ca.includes('BEGIN CERTIFICATE')) {
    throw new Error(
      'DB_SSL_CA belum diatur dengan sertifikat CA TiDB Cloud yang valid.'
    );
  }

  if (ca.includes('BEGIN CERTIFICATE')) {
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

// =========================================================
// DATABASE POOL
// =========================================================

const sharedDbPool = MYSQL_ENABLED
  ? mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(
        process.env.DB_PORT || (IS_VERCEL ? 4000 : 3306)
      ),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,

      waitForConnections: true,
      connectionLimit: IS_VERCEL ? 2 : 5,
      maxIdle: IS_VERCEL ? 1 : 5,
      idleTimeout: 60000,
      queueLimit: 0,
      connectTimeout: 15000,

      enableKeepAlive: true,
      keepAliveInitialDelay: 0,

      dateStrings: true,
      timezone: '+08:00',
      charset: 'utf8mb4',

      ssl: getDatabaseSsl()
    })
  : null;

// =========================================================
// VALIDASI KONFIGURASI
// =========================================================

if (!/^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(BASE)) {
  throw new Error('Periksa baseUrl di lib/helpers.js.');
}

if (
  PROD &&
  (
    !process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32
  )
) {
  throw new Error(
    'Production membutuhkan SESSION_SECRET minimal 32 karakter.'
  );
}

if (
  PROD &&
  (
    store.mode !== 'mysql' ||
    !process.env.DB_NAME
  )
) {
  throw new Error(
    'Production membutuhkan DB_MODE=mysql dan DB_NAME.'
  );
}

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

if (IS_VERCEL || process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

// =========================================================
// SECURITY HEADERS
// =========================================================

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=()',

    'Content-Security-Policy':
      "object-src 'none'; base-uri 'self'; " +
      "frame-ancestors 'self'; form-action 'self'",

    'X-MediaCenter-Build': VERSION
  });

  if (PROD && req.secure) {
    res.set('Strict-Transport-Security', 'max-age=31536000');
  }

  next();
});

// =========================================================
// STATIC ASSETS
// =========================================================

app.use(
  BASE + '/assets',
  express.static(ASSETS, {
    dotfiles: 'deny',
    fallthrough: false,
    etag: true,
    maxAge: 0,

    setHeaders(res, filename) {
      if (/\.(css|js)$/i.test(filename)) {
        res.set('Cache-Control', 'no-cache, must-revalidate');
      } else if (
        /\.(jpe?g|png|webp|avif|svg|ico)$/i.test(filename)
      ) {
        res.set('Cache-Control', 'public, max-age=86400');
      }
    }
  })
);

// =========================================================
// DIAGNOSTIK CSS
// =========================================================

if (!PROD) {
  app.get(
    [BASE + '/diagnostik-css', '/diagnostik-css'],
    (req, res) => {
      const cssPath = path.join(ASSETS, 'css', 'home.css');
      const headerPath = path.join(
        __dirname,
        'views',
        'partials',
        'header.ejs'
      );

      const css = fs.existsSync(cssPath)
        ? fs.readFileSync(cssPath, 'utf8')
        : '';

      const header = fs.existsSync(headerPath)
        ? fs.readFileSync(headerPath, 'utf8')
        : '';

      res.set('Cache-Control', 'no-store');

      res.json({
        serverAktif: true,
        versiServer: VERSION,
        cssDitemukan: Boolean(css),
        ukuranBytes: Buffer.byteLength(css),
        aturanBerandaTersedia:
          css.includes('.gov-home-news-grid'),
        headerMemuatHomeCss:
          header.includes('home.css'),
        urlCSS: BASE + '/assets/css/home.css',
        urlBeranda: BASE + '/',
        urlAdmin: ADMIN + '/login'
      });
    }
  );
}

// =========================================================
// BODY PARSER
// =========================================================

app.use(
  express.urlencoded({
    extended: false,
    limit: '128kb',
    parameterLimit: 50
  })
);

app.use(
  express.json({
    limit: '128kb'
  })
);

// =========================================================
// HELPER
// =========================================================

const asyncRoute = handler => (req, res, next) =>
  Promise.resolve()
    .then(() => handler(req, res, next))
    .catch(next);

const cleanText = (value, max = 255) =>
  (
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : ''
  )
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    .trim()
    .slice(0, max);

function intInRange(value, fallback = 1, max = 1000) {
  if (!/^\d+$/.test(String(value ?? ''))) {
    return fallback;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0
    ? Math.min(number, max)
    : fallback;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(value + 'T12:00:00Z');

  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().startsWith(value);
}

function validPortal(url) {
  try {
    const parsed = new URL(url);

    return parsed.protocol === 'https:' &&
      /(^|\.)hstkab\.go\.id$/i.test(parsed.hostname) &&
      !parsed.username &&
      !parsed.password;
  } catch {
    return false;
  }
}

function renderPublic(res, name, data = {}) {
  return res.render('public/' + name, data);
}

function renderAdmin(res, name, data = {}) {
  res.set('Cache-Control', 'no-store');
  return res.render('admin/' + name, data);
}

function setBaseLocals(req, res, next) {
  Object.assign(res.locals, H, H.nowTime());
  next();
}

// =========================================================
// MYSQL SESSION STORE
// =========================================================

class MySQLSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  execute(callback, operation) {
    Promise.resolve()
      .then(operation)
      .then(result => {
        if (typeof callback === 'function') {
          callback(null, result);
        }
      })
      .catch(error => {
        if (typeof callback === 'function') {
          callback(error);
        } else {
          console.error('Session store:', error.message);
        }
      });
  }

  get(sessionId, callback) {
    this.execute(callback, async () => {
      const [rows] = await this.pool.execute(
        `SELECT data, expires
         FROM admin_sessions
         WHERE session_id = ?
         LIMIT 1`,
        [sessionId]
      );

      if (!rows.length) return null;

      if (Number(rows[0].expires) <= Date.now()) {
        await this.pool.execute(
          'DELETE FROM admin_sessions WHERE session_id = ?',
          [sessionId]
        );
        return null;
      }

      try {
        return JSON.parse(rows[0].data);
      } catch {
        await this.pool.execute(
          'DELETE FROM admin_sessions WHERE session_id = ?',
          [sessionId]
        );
        return null;
      }
    });
  }

  set(sessionId, sess, callback) {
    this.execute(callback, async () => {
      const cookieExpiry = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000;

      const expires = Number.isFinite(cookieExpiry)
        ? cookieExpiry
        : Date.now() + 8 * 60 * 60 * 1000;

      await this.pool.execute(
        `INSERT INTO admin_sessions
          (session_id, expires, data)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
          expires = VALUES(expires),
          data = VALUES(data)`,
        [sessionId, expires, JSON.stringify(sess)]
      );
    });
  }

  destroy(sessionId, callback) {
    this.execute(callback, async () => {
      await this.pool.execute(
        'DELETE FROM admin_sessions WHERE session_id = ?',
        [sessionId]
      );
    });
  }

  touch(sessionId, sess, callback) {
    this.execute(callback, async () => {
      const cookieExpiry = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000;

      const expires = Number.isFinite(cookieExpiry)
        ? cookieExpiry
        : Date.now() + 8 * 60 * 60 * 1000;

      await this.pool.execute(
        'UPDATE admin_sessions SET expires = ? WHERE session_id = ?',
        [expires, sessionId]
      );
    });
  }
}

const sessionStore = MYSQL_ENABLED
  ? new MySQLSessionStore(sharedDbPool)
  : undefined;

adminRouter.use(session({
  name: 'mediacenter.admin.sid',
  secret:
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString('hex'),

  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: PROD,

  cookie: {
    path: ADMIN,
    httpOnly: true,
    sameSite: 'lax',
    secure: PROD,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

// =========================================================
// VARIABEL EJS ADMIN
// =========================================================

adminRouter.use(setBaseLocals);

adminRouter.use((req, res, next) => {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(32).toString('hex');
  }

  const currentPage =
    req.path.includes('/pengaturan')
      ? 'pengaturan.php'
      : req.path.includes('/edit')
        ? 'edit-berita.php'
        : req.path.includes('/tambah')
          ? 'tambah-berita.php'
          : req.path.includes('/berita')
            ? 'berita.php'
            : 'index.php';

  Object.assign(res.locals, {
    csrfToken: req.session.csrf,
    username: req.session.username || 'Administrator',
    currentPage,
    navActive: 'admin',
    isDashboard: currentPage === 'index.php',

    kontenActive: [
      'berita.php',
      'edit-berita.php',
      'tambah-berita.php'
    ].includes(currentPage),

    isPengaturan: currentPage === 'pengaturan.php'
  });

  res.set('Cache-Control', 'no-store');
  next();
});

// =========================================================
// AUTHENTICATION & CSRF
// =========================================================

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.redirect(302, ADMIN + '/login');
  }

  next();
}

function verifyCsrf(req, res, next) {
  const expected = Buffer.from(
    req.session.csrf || '',
    'utf8'
  );

  const received = Buffer.from(
    typeof req.body?.csrf_token === 'string'
      ? req.body.csrf_token
      : '',
    'utf8'
  );

  if (
    !expected.length ||
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    return res.status(403).send(
      'Formulir tidak valid. Muat ulang halaman.'
    );
  }

  next();
}

// =========================================================
// LOGIN RATE LIMIT
// =========================================================

const failures = new Map();
const ipFailures = new Map();
const WINDOW = 15 * 60 * 1000;

function rateKey(req) {
  return crypto.createHash('sha256')
    .update(
      `${req.ip}|${cleanText(
        req.body?.username,
        100
      ).toLowerCase()}`
    )
    .digest('hex');
}

function loginLimit(req, res, next) {
  const key = rateKey(req);
  const now = Date.now();

  const hit = failures.get(key);
  const ipHit = ipFailures.get(String(req.ip));

  if (
    (hit && hit.until > now && hit.count >= 7) ||
    (ipHit && ipHit.until > now && ipHit.count >= 40)
  ) {
    const until = Math.max(
      hit?.until || 0,
      ipHit?.until || 0
    );

    res.set(
      'Retry-After',
      String(Math.ceil((until - now) / 1000))
    );

    return res.status(429).render('admin/login', {
      error:
        'Terlalu banyak percobaan. Coba kembali dalam 15 menit.'
    });
  }

  if (hit && hit.until <= now) {
    failures.delete(key);
  }

  if (ipHit && ipHit.until <= now) {
    ipFailures.delete(String(req.ip));
  }

  req.rateKey = key;
  req.rateIP = String(req.ip);

  next();
}

function incrementCounter(map, key) {
  const now = Date.now();
  const old = map.get(key);

  map.set(
    key,
    old && old.until > now
      ? {
          count: old.count + 1,
          until: old.until
        }
      : {
          count: 1,
          until: now + WINDOW
        }
  );

  if (map.size > 10000) {
    for (const [id, record] of map) {
      if (record.until <= now) {
        map.delete(id);
      }
    }

    if (map.size > 10000) {
      const removeCount = Math.ceil(map.size * 0.1);
      let removed = 0;

      for (const id of map.keys()) {
        map.delete(id);
        removed += 1;
        if (removed >= removeCount) break;
      }
    }
  }
}

function loginFailed(req) {
  incrementCounter(failures, req.rateKey);
  incrementCounter(ipFailures, req.rateIP);
}

// =========================================================
// VALIDASI PASSWORD ADMIN
// =========================================================

function timingSafeHexEqual(left, right) {
  if (
    !/^[a-f0-9]{128}$/i.test(String(left || '')) ||
    !/^[a-f0-9]{128}$/i.test(String(right || ''))
  ) {
    return false;
  }

  const a = Buffer.from(String(left), 'hex');
  const b = Buffer.from(String(right), 'hex');

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

async function verifyAdminPassword(password, user) {
  const storedHash = String(
    user?.password || user?.password_hash || ''
  ).trim();

  // Bcrypt: format hash yang digunakan database saat ini.
  if (/^\$2[aby]\$\d{2}\$/.test(storedHash)) {
    try {
      return await bcrypt.compare(
        password,
        storedHash.replace(/^\$2y\$/, '$2a$')
      );
    } catch {
      return false;
    }
  }

  // Kompatibilitas SHA-512 lama.
  if (/^[a-f0-9]{128}$/i.test(storedHash)) {
    const candidate = crypto
      .createHash('sha512')
      .update(password, 'utf8')
      .digest('hex');

    if (!timingSafeHexEqual(candidate, storedHash.toLowerCase())) {
      return false;
    }

    if (sharedDbPool && user?.id) {
      try {
        const upgradedHash = await bcrypt.hash(password, 12);

        await sharedDbPool.execute(
          'UPDATE users SET password = ? WHERE id = ?',
          [upgradedHash, user.id]
        );
      } catch (error) {
        console.warn(
          'Migrasi password admin:',
          error.message
        );
      }
    }

    return true;
  }

  return false;
}

// =========================================================
// UPLOAD GAMBAR BERITA
// =========================================================

const imageUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1,
    fields: 15,
    parts: 16
  },

  fileFilter(req, file, cb) {
    const allowed =
      /^image\/(jpeg|png|webp)$/.test(file.mimetype);

    if (!allowed) {
      req.uploadError = 'Gambar harus JPG, PNG, atau WebP.';
    }

    cb(null, allowed);
  }
}).single('gambar');

function parseImage(req, res, next) {
  imageUpload(req, res, error => {
    if (error) {
      req.uploadError =
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Ukuran gambar maksimal 2 MB.'
          : 'Upload tidak valid.';

      req.file = undefined;
    }

    next();
  });
}

function imageExtension(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;

  if (
    buffer.length >= 3 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255
  ) {
    return 'jpg';
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([
        137, 80, 78, 71,
        13, 10, 26, 10
      ])
    )
  ) {
    return 'png';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }

  return null;
}

async function saveImage(file) {
  if (!file) return null;

  const ext = imageExtension(file.buffer);

  if (!ext) {
    throw new Error('Isi file gambar tidak valid.');
  }

  await fs.promises.mkdir(
    UPLOAD_DIR,
    { recursive: true }
  );

  const filename =
    crypto.randomBytes(16).toString('hex') + '.' + ext;

  await fs.promises.writeFile(
    path.join(UPLOAD_DIR, filename),
    file.buffer,
    { flag: 'wx' }
  );

  return 'berita/' + filename;
}

async function deleteImage(savedPath) {
  if (typeof savedPath !== 'string') return;

  const value = savedPath.replace(/\\/g, '/');
  const filename = path.posix.basename(value);

  if (
    ![`berita/${filename}`].includes(value) ||
    !/^[a-z\d_.-]+\.(?:jpe?g|png|webp)$/i.test(filename)
  ) {
    return;
  }

  try {
    await fs.promises.unlink(
      path.join(UPLOAD_DIR, filename)
    );
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('Hapus gambar:', err.message);
    }
  }
}

// =========================================================
// VALIDASI DATA BERITA
// =========================================================

function newsFields(req) {
  return {
    judul: cleanText(req.body?.judul, 255),
    isi: cleanText(req.body?.isi, 100000),
    kategori: cleanText(req.body?.kategori, 100),
    tanggal: cleanText(req.body?.tanggal, 10),
    penulis: cleanText(req.body?.penulis, 150),
    sumber: cleanText(req.body?.sumber, 255)
  };
}

function newsErrors(data, uploadError) {
  const errors = [];

  if (!data.judul) errors.push('Judul wajib diisi.');
  if (!data.isi) errors.push('Isi berita wajib diisi.');
  if (!data.kategori) errors.push('Kategori wajib diisi.');

  if (!validDate(data.tanggal)) {
    errors.push('Tanggal publikasi tidak valid.');
  }

  if (uploadError) errors.push(uploadError);

  return errors;
}

function blankNews() {
  return {
    judul: '',
    isi: '',
    kategori: '',

    tanggal: new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Makassar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date()),

    penulis: '',
    sumber: '',
    gambar: null
  };
}

async function removeNews(id) {
  const record = id
    ? await store.getById(id)
    : null;

  if (!record) return false;

  await store.deleteNews(id);
  await deleteImage(record.gambar);

  return true;
}
// =========================================================
// KUALITAS UDARA BARABAI
// =========================================================

const AIR_PLACE = 'Barabai, Hulu Sungai Tengah';
const AIR_TTL = 10 * 60 * 1000;

const AIR_URL = new URL(
  'https://air-quality-api.open-meteo.com/v1/air-quality'
);

AIR_URL.search = new URLSearchParams({
  latitude: String(Number(process.env.AIR_LAT ?? -2.5854)),
  longitude: String(Number(process.env.AIR_LON ?? 115.3846)),
  current: 'us_aqi,pm2_5,pm10',
  timezone: 'Asia/Makassar'
}).toString();

const airPool = sharedDbPool;

let cachedAir = null;
let cachedUntil = 0;
let pendingAir = null;

const numeric = value =>
  value == null ||
  value === '' ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);

function category(aqi) {
  if (aqi <= 50) {
    return [
      'baik',
      'Baik',
      'Kondisi udara baik untuk kegiatan luar ruangan.'
    ];
  }

  if (aqi <= 100) {
    return [
      'sedang',
      'Sedang',
      'Kelompok sangat sensitif perlu memperhatikan gejala.'
    ];
  }

  if (aqi <= 150) {
    return [
      'sensitif',
      'Tidak Sehat untuk Kelompok Sensitif',
      'Kelompok sensitif sebaiknya mengurangi aktivitas berat di luar ruangan.'
    ];
  }

  if (aqi <= 200) {
    return [
      'tidak-sehat',
      'Tidak Sehat',
      'Kurangi aktivitas berat di luar ruangan.'
    ];
  }

  if (aqi <= 300) {
    return [
      'sangat-tidak-sehat',
      'Sangat Tidak Sehat',
      'Batasi kegiatan luar ruangan dan ikuti informasi kesehatan setempat.'
    ];
  }

  return [
    'berbahaya',
    'Berbahaya',
    'Hindari aktivitas luar ruangan yang tidak mendesak.'
  ];
}

function airResult(raw, archived = false, saved = false) {
  const waktu = String(raw.waktu_data || '').replace(' ', 'T');

  const when = new Date(
    waktu +
    (
      /(Z|[+-]\d{2}:\d{2})$/i.test(waktu)
        ? ''
        : '+08:00'
    )
  );

  const age = Date.now() - when.getTime();
  const [kode, label, saran] = category(Number(raw.aqi));

  return {
    lokasi: AIR_PLACE,
    aqi: Number(raw.aqi),
    pm25: numeric(raw.pm25),
    pm10: numeric(raw.pm10),
    waktu_data: waktu,
    kode,
    label,
    saran,

    arsip:
      archived ||
      !Number.isFinite(age) ||
      age > 3 * 3600000 ||
      age < -90 * 60000,

    tersimpan: saved,
    sumber: 'Open-Meteo / Copernicus CAMS',
    indeks: 'US AQI',

    jenis_data:
      'Estimasi model per jam, bukan sensor langsung atau ISPU Indonesia'
  };
}

async function liveAir() {
  const response = await fetch(AIR_URL, {
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error('API AQI HTTP ' + response.status);
  }

  const data = (await response.json()).current || {};
  const aqi = numeric(data.us_aqi);

  if (
    aqi === null ||
    aqi < 0 ||
    aqi > 1000 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(
      String(data.time || '')
    )
  ) {
    throw new Error('Respons kualitas udara tidak valid.');
  }

  return airResult({
    aqi,
    pm25: data.pm2_5,
    pm10: data.pm10,
    waktu_data: data.time
  });
}

async function saveAir(item) {
  if (!airPool) return false;

  const time =
    item.waktu_data.replace('T', ' ') +
    (item.waktu_data.length === 16 ? ':00' : '');

  await airPool.execute(
    `INSERT INTO kualitas_udara
      (lokasi, waktu_data, aqi_us, pm25, pm10)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      aqi_us = VALUES(aqi_us),
      pm25 = VALUES(pm25),
      pm10 = VALUES(pm10)`,
    [
      AIR_PLACE,
      time,
      item.aqi,
      item.pm25,
      item.pm10
    ]
  );

  return true;
}

async function lastAir() {
  if (!airPool) return null;

  const [rows] = await airPool.execute(
    `SELECT aqi_us, pm25, pm10, waktu_data
     FROM kualitas_udara
     WHERE lokasi = ?
     ORDER BY waktu_data DESC
     LIMIT 1`,
    [AIR_PLACE]
  );

  if (!rows.length) return null;

  const row = rows[0];

  return airResult({
    aqi: row.aqi_us,
    pm25: row.pm25,
    pm10: row.pm10,
    waktu_data: row.waktu_data
  }, true, true);
}

async function getAir() {
  if (cachedAir && Date.now() < cachedUntil) {
    return airResult(
      cachedAir,
      cachedAir.arsip,
      cachedAir.tersimpan
    );
  }

  if (pendingAir) return pendingAir;

  pendingAir = (async () => {
    try {
      const fresh = await liveAir();

      try {
        fresh.tersimpan = await saveAir(fresh);
      } catch (error) {
        console.warn('Simpan AQI:', error.message);
      }

      cachedAir = fresh;
      cachedUntil = Date.now() + AIR_TTL;

      return fresh;
    } catch (error) {
      console.warn('Perbarui AQI:', error.message);

      let old = null;

      try {
        old = await lastAir();
      } catch (dbError) {
        console.warn('Arsip AQI:', dbError.message);
      }

      if (!old && cachedAir) {
        old = airResult(
          cachedAir,
          true,
          cachedAir.tersimpan
        );
      }

      if (!old) {
        throw new Error('Kualitas udara belum tersedia.');
      }

      cachedAir = old;
      cachedUntil = Date.now() + 60000;

      return old;
    }
  })();

  try {
    return await pendingAir;
  } finally {
    pendingAir = null;
  }
}

// =========================================================
// ROUTER PUBLIK
// =========================================================

publicRouter.use(setBaseLocals);

publicRouter.use((req, res, next) => {
  res.locals.navActive =
    req.path.startsWith('/tentang')
      ? 'tentang'
      : req.path.startsWith('/berita') ||
        req.path.startsWith('/detail')
        ? 'berita'
        : 'beranda';

  next();
});

// =========================================================
// BERANDA
// =========================================================

publicRouter.get(
  ['/', '/beranda', '/index', '/index.php'],

  asyncRoute(async (req, res) => {
    const news = await store.latestNews(7);

    renderPublic(res, 'index', {
      pageTitle:
        'Media Center Kabupaten Hulu Sungai Tengah',

      pageDescription:
        'Berita, pelayanan publik, dan informasi Pemerintah Kabupaten Hulu Sungai Tengah.',

      utama: news[0] || null,
      updates: news.slice(1)
    });
  })
);

// =========================================================
// API KUALITAS UDARA
// =========================================================

publicRouter.get('/kualitas-udara', (req, res) => {
  res.redirect(302, BASE + '/');
});

publicRouter.get(
  '/api/kualitas-udara',

  asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    try {
      res.json(await getAir());
    } catch {
      res.status(503).json({
        error: 'Data kualitas udara belum tersedia.'
      });
    }
  })
);

// =========================================================
// DAFTAR BERITA
// =========================================================

publicRouter.get(
  '/berita',

  asyncRoute(async (req, res) => {
    const q = cleanText(req.query.q, 100);
    const kategori = cleanText(req.query.kategori, 100);

    const rawYear = intInRange(req.query.tahun, 0, 9999);

    const tahun =
      rawYear >= 1900 && rawYear <= 2100
        ? rawYear
        : 0;

    const urut =
      req.query.urut === 'terlama'
        ? 'terlama'
        : 'terbaru';

    const page = intInRange(req.query.page);
    const limit = 9;

    const [result, categories, archiveYears] =
      await Promise.all([
        store.listNews({
          q,
          kategori,
          tahun,
          urut,
          page,
          limit
        }),

        store.categories(),
        store.years()
      ]);

    const { rows, total } = result;

    renderPublic(res, 'berita', {
      pageTitle:
        'Berita dan Informasi | Media Center HST',

      pageDescription:
        'Arsip publikasi Pemerintah Kabupaten Hulu Sungai Tengah.',

      q,
      kategori,
      tahun,
      urut,
      page,

      newsRows: rows,
      totalBerita: total,

      totalPages: Math.max(1, Math.ceil(total / limit)),

      start: total
        ? (page - 1) * limit + 1
        : 0,

      end: Math.min(page * limit, total),

      hasFilter: Boolean(
        q || kategori || tahun || urut === 'terlama'
      ),

      categories,
      archiveYears
    });
  })
);

// =========================================================
// DETAIL BERITA
// =========================================================

publicRouter.get(
  '/detail',

  asyncRoute(async (req, res) => {
    const slug = cleanText(req.query.slug, 180);

    if (!slug) {
      return res.redirect(302, BASE + '/berita');
    }

    const berita =
      /^[a-z\d_-]+$/i.test(slug)
        ? await store.getBySlug(slug)
        : null;

    const kategori = berita?.kategori || 'Informasi';

    const relatedItems = berita
      ? (
          await store.listNews({
            kategori,
            limit: 8
          })
        ).rows
          .filter(row => row.id !== berita.id)
          .slice(0, 3)
      : [];

    if (!berita) res.status(404);

    renderPublic(res, 'detail', {
      pageTitle: berita
        ? berita.judul + ' | Media Center HST'
        : 'Berita tidak ditemukan | Media Center HST',

      pageDescription: berita
        ? H.excerpt(berita.isi, 155)
        : 'Informasi tidak ditemukan.',

      berita,
      kategori,

      penulis: berita?.penulis || 'Media Center HST',
      sumber: berita?.sumber || 'Belum dicantumkan',

      gambar: berita
        ? H.gambarUrl(berita.gambar)
        : '',

      publishedText: berita
        ? H.tanggalBerita(berita.tanggal)
        : '',

      updatedText: berita
        ? H.waktuAdmin(berita.updated_at)
        : '',

      paragraphs: berita
        ? String(berita.isi)
            .split(/\r?\n+/)
            .map(s => s.trim())
            .filter(Boolean)
        : [],

      relatedItems
    });
  })
);

// =========================================================
// TENTANG MEDIA CENTER
// =========================================================

publicRouter.get(
  '/tentang',

  asyncRoute(async (req, res) => {
    const settings = await store.getSettings();

    const portalUrl = validPortal(settings.portal_url)
      ? settings.portal_url
      : PORTAL;

    renderPublic(res, 'tentang', {
      pageTitle:
        'Tentang Media Center | Kabupaten Hulu Sungai Tengah',

      pageDescription:
        H.excerpt(settings.about_description, 155),

      settings,
      portalUrl
    });
  })
);

// =========================================================
// MAINTENANCE MODE
// =========================================================

app.use((req, res, next) => {
  if (process.env.MAINTENANCE_MODE !== '1') {
    return next();
  }

  const url = req.path;

  const isPublicArea =
    url === BASE || url.startsWith(BASE + '/');

  const isAdminArea =
    url === ADMIN || url.startsWith(ADMIN + '/');

  const isAsset =
    url.startsWith(BASE + '/assets/');

  if (!isPublicArea || isAdminArea || isAsset) {
    return next();
  }

  res.set({
    'Cache-Control': 'no-store, max-age=0',
    'Retry-After': '3600',
    'X-Robots-Tag': 'noindex, nofollow'
  });

  return res.status(503).type('html').send(`
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0B2E4F">
  <title>Pemeliharaan Sistem | Media Center HST</title>
  <style>
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      padding: 24px;
      display: grid;
      place-items: center;
      background: #F3F6F9;
      color: #173A55;
      font-family: system-ui, sans-serif;
    }
    main {
      width: min(100%, 760px);
      padding: 36px;
      border: 1px solid #DDE5ED;
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 15px 45px #0B2E4F12;
    }
    .brand {
      color: #0B2E4F;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: .04em;
    }
    .status {
      display: inline-block;
      margin-top: 30px;
      padding: 7px 11px;
      border-radius: 6px;
      background: #EDF5FB;
      color: #1F6FA8;
      font-size: 11px;
      font-weight: 800;
    }
    h1 {
      margin: 15px 0;
      font-size: clamp(25px, 4vw, 36px);
      line-height: 1.25;
    }
    p {
      max-width: 58ch;
      color: #536B7F;
      font-size: 14px;
      line-height: 1.8;
    }
    a {
      display: inline-block;
      margin-top: 14px;
      padding: 12px 18px;
      border-radius: 7px;
      background: #0B2E4F;
      color: white;
      text-decoration: none;
      font-size: 13px;
      font-weight: 700;
    }
    @media (max-width: 500px) {
      main { padding: 25px 20px; }
    }
  </style>
</head>
<body>
  <main>
    <div class="brand">
      PEMERINTAH KABUPATEN HULU SUNGAI TENGAH
      <br>MEDIA CENTER HST
    </div>
    <span class="status">STATUS 503</span>
    <h1>Website sedang dalam pemeliharaan</h1>
    <p>
      Kami sedang melakukan pemeliharaan sistem untuk
      meningkatkan keandalan layanan informasi publik.
      Silakan coba kembali beberapa saat lagi.
    </p>
    <a href="${BASE}/">Coba Lagi</a>
  </main>
</body>
</html>
  `);
});
// =========================================================
// LOGIN ADMIN
// =========================================================

adminRouter.get(
  '/login',
  asyncRoute(async (req, res) => {
    if (req.session.adminId) {
      return res.redirect(302, ADMIN);
    }

    if (!req.session.csrf) {
      req.session.csrf = crypto.randomBytes(32).toString('hex');
    }

    await new Promise((resolve, reject) => {
      req.session.save(error => {
        if (error) return reject(error);
        resolve();
      });
    });

    res.locals.csrfToken = req.session.csrf;

    return renderAdmin(res, 'login', {
      error: ''
    });
  })
);

adminRouter.post(
  '/login',
  verifyCsrf,
  loginLimit,

  asyncRoute(async (req, res) => {
    const username = cleanText(
      req.body?.username,
      100
    );

    const password =
      typeof req.body?.password === 'string'
        ? req.body.password
        : '';

    // Validasi input
    if (
      !username ||
      !password ||
      password.length > 1024
    ) {
      loginFailed(req);

      return renderAdmin(
        res.status(401),
        'login',
        {
          error: 'Username atau password tidak sesuai.'
        }
      );
    }

    // Cari administrator
    const user = await store.getUser(username);

    let valid = false;

    if (user) {
      valid = await verifyAdminPassword(
        password,
        user
      );
    } else {
      // Dummy comparison untuk mengurangi perbedaan waktu respons
      await bcrypt.compare(password, DUMMY_HASH);
    }

    // Validasi kredensial
    if (
      !user ||
      !valid ||
      user.is_active === false ||
      user.is_active === 0
    ) {
      loginFailed(req);

      return renderAdmin(
        res.status(401),
        'login',
        {
          error: 'Username atau password tidak sesuai.'
        }
      );
    }

    // Bersihkan percobaan login setelah berhasil
    failures.delete(req.rateKey);
    ipFailures.delete(req.rateIP);

    // Regenerasi session untuk mencegah session fixation
    await new Promise((resolve, reject) => {
      req.session.regenerate(error => {
        if (error) return reject(error);
        resolve();
      });
    });

    req.session.adminId = user.id;
    req.session.username = user.username;

    req.session.csrf = crypto.randomBytes(32).toString('hex');

    // Simpan session sebelum redirect
    await new Promise((resolve, reject) => {
      req.session.save(error => {
        if (error) return reject(error);
        resolve();
      });
    });

    return res.redirect(303, ADMIN);
  })
);

// =========================================================
// PROSES LOGIN
// =========================================================

adminRouter.post(
  '/login',
  verifyCsrf,
  loginLimit,

  asyncRoute(async (req, res) => {
    const username = cleanText(
      req.body?.username,
      100
    );

    const password =
      typeof req.body?.password === 'string'
        ? req.body.password
        : '';

    // Validasi input
    if (
      !username ||
      !password ||
      password.length > 1024
    ) {
      loginFailed(req);

      return renderAdmin(
        res.status(401),
        'login',
        {
          error: 'Username atau password tidak sesuai.'
        }
      );
    }

    // Ambil akun administrator
    const user = await store.getUser(username);

    // Ambil hash password dari database
    const storedHash = String(
      user?.password ||
      user?.password_hash ||
      ''
    ).trim();

    // Normalisasi format bcrypt
    const hash = storedHash.replace(
      /^\$2y\$/,
      '$2a$'
    );

    const validHash =
      /^\$2[ab]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash);

    let valid = false;

    // Verifikasi password
    if (user && validHash) {
      try {
        valid = await bcrypt.compare(
          password,
          hash
        );
      } catch (error) {
        console.error(
          '[ADMIN BCRYPT ERROR]',
          error.message
        );
      }
    } else {
      // Dummy comparison untuk mengurangi perbedaan waktu respons
      try {
        await bcrypt.compare(
          password,
          DUMMY_HASH
        );
      } catch {
        // Abaikan kegagalan dummy comparison.
      }
    }

    // Periksa status akun
    const inactive = user && (
      user.is_active === false ||
      user.is_active === 0 ||
      user.is_active === '0'
    );

    // Tolak autentikasi jika tidak valid
    if (!user || !valid || inactive) {
      loginFailed(req);

      return renderAdmin(
        res.status(401),
        'login',
        {
          error: 'Username atau password tidak sesuai.'
        }
      );
    }

    // Bersihkan penghitung kegagalan
    failures.delete(req.rateKey);
    ipFailures.delete(req.rateIP);

    // Regenerasi session
    await new Promise((resolve, reject) => {
      req.session.regenerate(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    // Simpan identitas administrator
    req.session.adminId = user.id;
    req.session.username = user.username;

    req.session.csrf = crypto
      .randomBytes(32)
      .toString('hex');

    // Simpan session sebelum redirect
    await new Promise((resolve, reject) => {
      req.session.save(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    return res.redirect(303, ADMIN);
  })
);

// =========================================================
// VERIFIKASI PASSWORD ADMIN
// Mendukung SHA-512 lama dan bcrypt
// =========================================================

function timingSafeHexEqual(left, right) {
  if (
    !/^[a-f0-9]{128}$/i.test(String(left || '')) ||
    !/^[a-f0-9]{128}$/i.test(String(right || ''))
  ) {
    return false;
  }

  const a = Buffer.from(String(left), 'hex');
  const b = Buffer.from(String(right), 'hex');

  return crypto.timingSafeEqual(a, b);
}

async function verifyAdminPassword(password, user) {
  const storedHash = String(
    user?.password || user?.password_hash || ''
  ).trim();

  // Password bcrypt
  if (/^\$2[aby]\$\d{2}\$/.test(storedHash)) {
    try {
      return await bcrypt.compare(
        password,
        storedHash.replace(/^\$2y\$/, '$2a$')
      );
    } catch {
      return false;
    }
  }

  // Password SHA-512 dari database lama
  if (/^[a-f0-9]{128}$/i.test(storedHash)) {
    const candidate = crypto
      .createHash('sha512')
      .update(password, 'utf8')
      .digest('hex');

    return timingSafeHexEqual(
      candidate,
      storedHash.toLowerCase()
    );
  }

  return false;
}
// =========================================================
// PROTEKSI SELURUH HALAMAN ADMIN
// =========================================================

adminRouter.use(requireAdmin);

// =========================================================
// DASHBOARD ADMIN
// =========================================================

adminRouter.get(
  '/',

  asyncRoute(async (req, res) => {
    const [
      stats,
      latestRows,
      chartData
    ] = await Promise.all([
      store.stats(),
      store.latestNews(5),
      store.activity()
    ]);

    const username =
      req.session.username || 'Administrator';

    renderAdmin(res, 'index', {
      initial:
        [...username.toUpperCase()][0] || 'A',

      username,

      totalBerita: Number(stats.totalBerita),
      totalKategori: Number(stats.totalKategori),
      totalGambar: Number(stats.totalGambar),

      updateTerakhir: H.waktuAdmin(stats.latest),

      persenGambar: Number(stats.totalBerita)
        ? Math.round(
            Number(stats.totalGambar) /
            Number(stats.totalBerita) * 100
          )
        : 0,

      latestRows,
      chartData,

      chartMax: Math.max(
        1,
        ...chartData.map(
          item => Number(item.count) || 0
        )
      ),

      isDeleted: req.query.status === 'deleted'
    });
  })
);

// =========================================================
// FUNGSI HAPUS BERITA
// =========================================================

async function deleteFromForm(req, res, returnUrl) {
  if (req.body?.action !== 'delete') {
    return res.redirect(303, returnUrl);
  }

  const id = intInRange(
    req.body.id,
    0,
    2147483647
  );

  const deleted = await removeNews(id);

  return res.redirect(
    303,
    returnUrl + (deleted ? '?status=deleted' : '')
  );
}

// =========================================================
// HAPUS BERITA DARI DASHBOARD
// =========================================================

adminRouter.post(
  '/',
  verifyCsrf,

  asyncRoute((req, res) =>
    deleteFromForm(req, res, ADMIN)
  )
);

// =========================================================
// DAFTAR BERITA ADMIN
// =========================================================

adminRouter.get(
  '/berita',

  asyncRoute(async (req, res) => {
    const q = cleanText(req.query.q, 100);
    const page = intInRange(req.query.page);
    const limit = 10;

    const { rows, total } = await store.listNews({
      q,
      page,
      limit
    });

    renderAdmin(res, 'berita', {
      q,
      page,
      total,

      totalPages: Math.max(
        1,
        Math.ceil(total / limit)
      ),

      rows,

      status: cleanText(req.query.status, 20)
    });
  })
);

// =========================================================
// HAPUS BERITA DARI DAFTAR BERITA
// =========================================================

adminRouter.post(
  '/berita',
  verifyCsrf,

  asyncRoute((req, res) =>
    deleteFromForm(req, res, ADMIN + '/berita')
  )
);

// =========================================================
// FORM TAMBAH BERITA
// =========================================================

adminRouter.get(
  '/berita/tambah',

  (req, res) => {
    renderAdmin(res, 'tambah-berita', {
      data: blankNews(),
      errors: []
    });
  }
);

// =========================================================
// SIMPAN BERITA BARU
// =========================================================

adminRouter.post(
  '/berita/tambah',
  parseImage,
  verifyCsrf,

  asyncRoute(async (req, res) => {
    const data = newsFields(req);

    const errors = newsErrors(
      data,
      req.uploadError
    );

    let image = null;

    if (!errors.length) {
      try {
        image = await saveImage(req.file);

        await store.createNews({
          ...data,
          gambar: image
        });

        return res.redirect(
          303,
          ADMIN + '/berita?status=created'
        );
      } catch (error) {
        await deleteImage(image);

        console.error('Tambah berita:', error);

        errors.push(
          'Berita tidak dapat disimpan. Silakan coba lagi.'
        );
      }
    }

    renderAdmin(res.status(422), 'tambah-berita', {
      data,
      errors
    });
  })
);

// =========================================================
// FORM EDIT BERITA
// =========================================================

adminRouter.get(
  '/berita/edit',

  asyncRoute(async (req, res) => {
    const id = intInRange(
      req.query.id,
      0,
      2147483647
    );

    const data = id
      ? await store.getById(id)
      : null;

    if (!data) {
      return res.status(404).send(
        'Berita tidak ditemukan.'
      );
    }

    renderAdmin(res, 'edit-berita', {
      data,
      errors: []
    });
  })
);

// =========================================================
// SIMPAN PERUBAHAN BERITA
// =========================================================

adminRouter.post(
  '/berita/edit',
  parseImage,
  verifyCsrf,

  asyncRoute(async (req, res) => {
    const id = intInRange(
      req.query.id,
      0,
      2147483647
    );

    const old = id
      ? await store.getById(id)
      : null;

    if (!old) {
      return res.status(404).send(
        'Berita tidak ditemukan.'
      );
    }

    const data = {
      ...old,
      ...newsFields(req)
    };

    const errors = newsErrors(
      data,
      req.uploadError
    );

    let newImage = null;

    if (!errors.length) {
      try {
        if (req.file) {
          newImage = await saveImage(req.file);
          data.gambar = newImage;
        } else if ('hapus_gambar' in (req.body || {})) {
          data.gambar = null;
        }

        await store.updateNews(id, data);

        if (
          old.gambar &&
          old.gambar !== data.gambar
        ) {
          await deleteImage(old.gambar);
        }

        return res.redirect(
          303,
          ADMIN + '/berita?status=updated'
        );
      } catch (error) {
        await deleteImage(newImage);

        console.error('Edit berita:', error);

        errors.push(
          'Perubahan tidak dapat disimpan. Silakan coba lagi.'
        );
      }
    }

    renderAdmin(res.status(422), 'edit-berita', {
      data,
      errors
    });
  })
);

// =========================================================
// FORM PENGATURAN
// =========================================================

adminRouter.get(
  '/pengaturan',

  asyncRoute(async (req, res) => {
    renderAdmin(res, 'pengaturan', {
      settings: await store.getSettings(),
      errors: [],
      status: cleanText(req.query.status, 20)
    });
  })
);

// =========================================================
// SIMPAN PENGATURAN
// =========================================================

adminRouter.post(
  '/pengaturan',
  verifyCsrf,

  asyncRoute(async (req, res) => {
    const settings = {
      about_title: cleanText(
        req.body.about_title,
        150
      ),

      about_description: cleanText(
        req.body.about_description,
        1500
      ),

      portal_url: cleanText(
        req.body.portal_url,
        300
      ) || PORTAL
    };

    const errors = [];

    if (settings.about_title.length < 5) {
      errors.push(
        'Judul profil minimal 5 karakter.'
      );
    }

    if (settings.about_description.length < 30) {
      errors.push(
        'Deskripsi Media Center minimal 30 karakter.'
      );
    }

    if (!validPortal(settings.portal_url)) {
      errors.push(
        'Portal harus domain HTTPS hstkab.go.id.'
      );
    }

    if (errors.length) {
      return renderAdmin(res.status(422), 'pengaturan', {
        settings,
        errors,
        status: ''
      });
    }

    await store.saveSettings(settings);

    return res.redirect(
      303,
      ADMIN + '/pengaturan?status=saved'
    );
  })
);

// =========================================================
// 404 KHUSUS ADMIN
// =========================================================

adminRouter.use((req, res) => {
  res.status(404).send(
    'Halaman administrator tidak ditemukan.'
  );
});
// =========================================================
// MOUNT ROUTER
// =========================================================

app.get('/', (req, res) => {
  res.redirect(302, BASE + '/');
});

// =========================================================
// ALIAS ADMIN
// =========================================================

const adminAliases = new Map([
  ['/admin', ADMIN],
  ['/admin/login', ADMIN + '/login'],
  ['/admin/index.php', ADMIN],
  ['/admin/login.php', ADMIN + '/login'],
  ['/admin/berita.php', ADMIN + '/berita'],
  ['/mediacenter/admin', ADMIN],
  ['/mediacenter/admin/login', ADMIN + '/login'],
  ['/mediacenter/admin/index.php', ADMIN]
]);

for (const [oldPath, destination] of adminAliases) {
  app.get(oldPath, (req, res) => {
    res.redirect(302, destination);
  });
}

// Admin harus didaftarkan sebelum router publik.
app.use(ADMIN, adminRouter);
app.use(BASE, publicRouter);

// =========================================================
// KOMPATIBILITAS URL PHP LAMA
// =========================================================

const legacy = {
  '/mediacenter/index.php': BASE + '/',
  '/mediacenter/berita.php': BASE + '/berita',
  '/mediacenter/detail.php': BASE + '/detail',
  '/mediacenter/tentang.php': BASE + '/tentang'
};

for (const [oldPath, destination] of Object.entries(legacy)) {
  app.get(BASE + oldPath, (req, res) => {
    const queryIndex = req.originalUrl.indexOf('?');

    const query = queryIndex < 0
      ? ''
      : req.originalUrl.slice(queryIndex);

    res.redirect(302, destination + query);
  });
}

// =========================================================
// GLOBAL 404
// =========================================================

app.use((req, res) => {
  const isAdmin =
    req.path === ADMIN ||
    req.path.startsWith(ADMIN + '/') ||
    req.path === '/admin' ||
    req.path.startsWith('/admin/');

  const primaryUrl = isAdmin
    ? ADMIN
    : BASE + '/';

  const primaryText = isAdmin
    ? 'Kembali ke Dashboard'
    : 'Kembali ke Beranda';

  const secondaryUrl = isAdmin
    ? ADMIN + '/login'
    : BASE + '/berita';

  const secondaryText = isAdmin
    ? 'Login Administrator'
    : 'Lihat Informasi';

  const logoUrl = BASE + '/assets/img/logo-hst.png';

  res.set({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow'
  });

  return res.status(404).type('html').send(`
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#0B2E4F">
  <title>404 - Halaman Tidak Ditemukan | Media Center HST</title>

  <style>
    :root {
      --navy: #0B2E4F;
      --blue: #1F6FA8;
      --background: #F4F7FA;
      --white: #FFFFFF;
      --text: #173B59;
      --muted: #687E91;
      --border: #E2EAF1;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--background);
      font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
      color: var(--text);
    }

    .error-card {
      width: 100%;
      max-width: 600px;
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 15px 45px rgba(11,46,79,.07);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 24px 30px;
      border-bottom: 1px solid var(--border);
      background: #FCFDFE;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .brand-logo {
      flex-shrink: 0;
      width: 54px;
      height: 58px;
      padding: 5px;
      border: 1px solid #E5ECF2;
      border-radius: 10px;
      background: white;
    }

    .brand-logo img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .government {
      display: block;
      color: var(--muted);
      font-size: 10px;
      font-weight: 750;
      letter-spacing: .075em;
      text-transform: uppercase;
    }

    .name {
      display: block;
      margin-top: 4px;
      color: var(--navy);
      font-size: 17px;
      font-weight: 800;
    }

    .subname {
      display: block;
      margin-top: 3px;
      color: var(--blue);
      font-size: 11px;
    }

    .status-label {
      flex-shrink: 0;
      padding: 8px 11px;
      border: 1px solid #DAE6F0;
      border-radius: 7px;
      background: #F1F6FA;
      color: var(--blue);
      font-size: 11px;
      font-weight: 750;
    }

    .card-content {
      padding: 40px 38px;
      text-align: center;
    }

    .error-icon {
      width: 78px;
      height: 78px;
      margin: 0 auto 23px;
      display: grid;
      place-items: center;
      background: #EDF5FB;
      border: 1px solid #DAE9F5;
      border-radius: 19px;
      color: var(--blue);
      font-size: 35px;
      font-weight: 700;
    }

    .error-code {
      margin: 0 0 8px;
      color: var(--blue);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .16em;
    }

    h1 {
      margin: 0;
      color: var(--navy);
      font-size: clamp(24px, 4vw, 32px);
      line-height: 1.3;
    }

    .description {
      max-width: 430px;
      margin: 15px auto 29px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.8;
    }

    .actions {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 11px;
    }

    .btn {
      min-height: 45px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 11px 19px;
      border-radius: 8px;
      border: 1px solid #D4E1EB;
      background: white;
      color: var(--navy);
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
    }

    .btn-primary {
      background: var(--navy);
      border-color: var(--navy);
      color: white;
    }

    .btn:focus-visible {
      outline: 3px solid #8BC7EF;
      outline-offset: 3px;
    }

    .card-footer {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding: 17px 30px;
      border-top: 1px solid var(--border);
      background: #FCFDFE;
      color: #788C9C;
      font-size: 11px;
    }

    @media (max-width: 600px) {
      body {
        padding: 14px;
      }

      .card-header {
        padding: 19px 18px;
      }

      .card-content {
        padding: 33px 22px;
      }

      .actions {
        flex-direction: column;
      }

      .btn {
        width: 100%;
      }

      .card-footer {
        padding: 15px 18px;
      }
    }
  </style>
</head>

<body>
  <main class="error-card" aria-labelledby="error-title">

    <header class="card-header">
      <div class="brand">
        <div class="brand-logo">
          <img
            src="${logoUrl}"
            alt="Lambang Kabupaten Hulu Sungai Tengah"
            width="44"
            height="48"
          >
        </div>

        <div>
          <span class="government">Pemerintah Kabupaten</span>
          <strong class="name">Hulu Sungai Tengah</strong>
          <span class="subname">Media Center HST</span>
        </div>
      </div>

      <span class="status-label">ERROR 404</span>
    </header>

    <section class="card-content">
      <div class="error-icon" aria-hidden="true">404</div>

      <p class="error-code">PAGE NOT FOUND</p>

      <h1 id="error-title">Halaman Tidak Ditemukan</h1>

      <p class="description">
        Maaf, halaman yang Anda cari tidak tersedia,
        telah dipindahkan, atau alamat yang dimasukkan
        tidak sesuai. Silakan kembali ke halaman utama.
      </p>

      <nav class="actions" aria-label="Navigasi halaman kesalahan">
        <a class="btn btn-primary" href="${primaryUrl}">
          ${primaryText}
        </a>

        <a class="btn" href="${secondaryUrl}">
          ${secondaryText}
        </a>
      </nav>
    </section>

    <footer class="card-footer">
      <span>© Media Center Kabupaten Hulu Sungai Tengah</span>
      <span>Layanan Informasi Pemerintah Daerah</span>
    </footer>

  </main>
</body>
</html>
  `);
});

// =========================================================
// ERROR HANDLING
// =========================================================

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const code =
    Number.isInteger(err.status) &&
    err.status >= 400 &&
    err.status <= 599
      ? err.status
      : 500;

  if (code >= 500) {
    console.error('Kesalahan server:', err);
  }

  if (code === 404) {
    return res.status(404).send(
      'Aset tidak ditemukan.'
    );
  }

  if (code === 413) {
    return res.status(413).send(
      'Ukuran unggahan melebihi batas.'
    );
  }

  return res.status(code).send(
    'Permintaan tidak dapat diproses.'
  );
});

// =========================================================
// START SERVER
// =========================================================

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Media Center HST ${VERSION}`);
    console.log(`Public : http://localhost:${PORT}${BASE}/`);
    console.log(`Admin  : http://localhost:${PORT}${ADMIN}/login`);
    console.log(`Storage: ${store.mode}`);
  });

  const shutdown = signal => {
    console.log(`${signal} received. Closing server...`);

    server.close(async () => {
      if (sharedDbPool) {
        try {
          await sharedDbPool.end();
        } catch (error) {
          console.error('Close DB pool:', error.message);
        }
      }

      process.exit(0);
    });

    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;