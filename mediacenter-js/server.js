
'use strict';

/**
 * MEDIA CENTER KABUPATEN HULU SUNGAI TENGAH
 *
 * Server satu file.
 * Area publik dan admin dipisahkan menggunakan Express Router.
 *
 * Node.js 20+
 * Express 4
 * EJS
 * MySQL / JSON sesuai lib/repository.js
 *
 * STRUKTUR:
 * 1. Konfigurasi dan keamanan
 * 2. Aset statis dan diagnostik
 * 3. Helper bersama
 * 4. Session dan keamanan admin
 * 5. Upload gambar dan berita
 * 6. Kualitas udara
 * 7. Route publik
 * 8. Route admin
 * 9. Alias, error, dan menjalankan server
 */

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

// =========================================================
// 1. KONFIGURASI UTAMA
// =========================================================

const app = express();

const publicRouter = express.Router();
const adminRouter = express.Router();

const BASE = H.baseUrl;
const ADMIN = BASE + '/admin';

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);

const VERSION = '2026.10.12-hst-v5-single-file';

const ASSETS = path.join(
  __dirname,
  'public',
  'assets'
);

const UPLOAD_DIR = path.join(
  ASSETS,
  'img',
  'berita'
);

const PORTAL = 'https://www.hstkab.go.id/';

const DUMMY_HASH =
  '$2a$10$NAWSEAGZrEoPpvNsG2qvC.BtGkDDGMuDDymd.dpb89ugwuCZbYPBO';

// =========================================================
// VALIDASI KONFIGURASI
// =========================================================

if (!/^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(BASE)) {
  throw new Error(
    'Periksa baseUrl di lib/helpers.js.'
  );
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

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

// =========================================================
// HEADER KEAMANAN
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
    res.set(
      'Strict-Transport-Security',
      'max-age=31536000'
    );
  }

  next();
});

// =========================================================
// 2. STATIC ASSETS
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
        res.set(
          'Cache-Control',
          'no-cache, must-revalidate'
        );
      } else if (
        /\.(jpe?g|png|webp|avif|svg|ico)$/i.test(filename)
      ) {
        res.set(
          'Cache-Control',
          'public, max-age=86400'
        );
      }
    }
  })
);

// =========================================================
// DIAGNOSTIK CSS - DEVELOPMENT SAJA
// =========================================================

if (!PROD) {
  app.get(
    [
      BASE + '/diagnostik-css',
      '/diagnostik-css'
    ],
    (req, res) => {
      const cssPath = path.join(
        ASSETS,
        'css',
        'home.css'
      );

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

        urlCSS:
          BASE + '/assets/css/home.css',

        urlBeranda:
          BASE + '/',

        urlAdmin:
          ADMIN + '/login'
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
// 3. HELPER BERSAMA
// =========================================================

const asyncRoute = handler => (req, res, next) =>
  Promise.resolve()
    .then(() => handler(req, res, next))
    .catch(next);

const cleanText = (value, max = 255) =>
  (
    typeof value === 'string' ||
    typeof value === 'number'
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
  return res.render(
    'public/' + name,
    data
  );
}

function renderAdmin(res, name, data = {}) {
  res.set('Cache-Control', 'no-store');

  return res.render(
    'admin/' + name,
    data
  );
}

function setBaseLocals(req, res, next) {
  Object.assign(
    res.locals,
    H,
    H.nowTime()
  );

  next();
}

// =========================================================
// 4. SESSION KHUSUS ADMIN
// =========================================================

let sessionStore;

if (PROD) {
  const MySQLSessionStore = require('./lib/mysql-session-store');

  sessionStore = new MySQLSessionStore({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    expiration: 8 * 60 * 60 * 1000,
    connectionLimit: 5
  });
}

// Session hanya aktif di router administrator.

adminRouter.use(
  session({
    name: 'mediacenter.admin.sid',

    secret:
      process.env.SESSION_SECRET ||
      crypto.randomBytes(32).toString('hex'),

    store: sessionStore,

    resave: false,
    saveUninitialized: false,
    rolling: true,

    cookie: {
      path: ADMIN,
      httpOnly: true,
      sameSite: 'lax',
      secure: PROD,
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

// =========================================================
// VARIABEL EJS ADMIN
// =========================================================

adminRouter.use(setBaseLocals);

adminRouter.use((req, res, next) => {
  if (!req.session.csrf) {
    req.session.csrf =
      crypto.randomBytes(32).toString('hex');
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

    username:
      req.session.username || 'Administrator',

    currentPage,
    navActive: 'admin',

    isDashboard:
      currentPage === 'index.php',

    kontenActive: [
      'berita.php',
      'edit-berita.php',
      'tambah-berita.php'
    ].includes(currentPage),

    isPengaturan:
      currentPage === 'pengaturan.php'
  });

  res.set('Cache-Control', 'no-store');

  next();
});

// =========================================================
// AUTHENTICATION
// =========================================================

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.redirect(
      302,
      ADMIN + '/login'
    );
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

    return res.status(429).render(
      'admin/login',
      {
        error:
          'Terlalu banyak percobaan. Coba kembali dalam 15 menit.'
      }
    );
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
      map.clear();
    }
  }
}

function loginFailed(req) {
  incrementCounter(
    failures,
    req.rateKey
  );

  incrementCounter(
    ipFailures,
    req.rateIP
  );
}

// =========================================================
// 5. UPLOAD GAMBAR BERITA
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
      /^image\/(jpeg|png|webp)$/.test(
        file.mimetype
      );

    if (!allowed) {
      req.uploadError =
        'Gambar harus JPG, PNG, atau WebP.';
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
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }

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
  if (!file) {
    return null;
  }

  const ext = imageExtension(file.buffer);

  if (!ext) {
    throw new Error(
      'Isi file gambar tidak valid.'
    );
  }

  await fs.promises.mkdir(
    UPLOAD_DIR,
    { recursive: true }
  );

  const filename =
    crypto.randomBytes(16).toString('hex') +
    '.' + ext;

  await fs.promises.writeFile(
    path.join(UPLOAD_DIR, filename),
    file.buffer,
    { flag: 'wx' }
  );

  return 'berita/' + filename;
}

async function deleteImage(savedPath) {
  if (typeof savedPath !== 'string') {
    return;
  }

  const value = savedPath.replace(/\\/g, '/');

  const filename =
    path.posix.basename(value);

  if (
    ![
      filename,
      `berita/${filename}`
    ].includes(value) ||
    !/^[a-z\d_.-]+\.(?:jpe?g|png|webp)$/i.test(
      filename
    )
  ) {
    return;
  }

  try {
    await fs.promises.unlink(
      path.join(UPLOAD_DIR, filename)
    );
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(
        'Hapus gambar:',
        err.message
      );
    }
  }
}

// =========================================================
// VALIDASI DATA BERITA
// =========================================================

function newsFields(req) {
  return {
    judul:
      cleanText(req.body?.judul, 255),

    isi:
      cleanText(req.body?.isi, 100000),

    kategori:
      cleanText(req.body?.kategori, 100),

    tanggal:
      cleanText(req.body?.tanggal, 10),

    penulis:
      cleanText(req.body?.penulis, 150),

    sumber:
      cleanText(req.body?.sumber, 255)
  };
}

function newsErrors(data, uploadError) {
  const errors = [];

  if (!data.judul) {
    errors.push('Judul wajib diisi.');
  }

  if (!data.isi) {
    errors.push('Isi berita wajib diisi.');
  }

  if (!data.kategori) {
    errors.push('Kategori wajib diisi.');
  }

  if (!validDate(data.tanggal)) {
    errors.push('Tanggal publikasi tidak valid.');
  }

  if (uploadError) {
    errors.push(uploadError);
  }

  return errors;
}

function blankNews() {
  return {
    judul: '',
    isi: '',
    kategori: '',

    tanggal:
      new Intl.DateTimeFormat(
        'sv-SE',
        {
          timeZone: 'Asia/Makassar',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }
      ).format(new Date()),

    penulis: '',
    sumber: '',
    gambar: null
  };
}

async function removeNews(id) {
  const record = id
    ? await store.getById(id)
    : null;

  if (!record) {
    return false;
  }

  await store.deleteNews(id);
  await deleteImage(record.gambar);

  return true;
}

// =========================================================
// 6. KUALITAS UDARA BARABAI
// =========================================================

const AIR_PLACE =
  'Barabai, Hulu Sungai Tengah';

const AIR_TTL =
  10 * 60 * 1000;

const AIR_URL = new URL(
  'https://air-quality-api.open-meteo.com/v1/air-quality'
);

AIR_URL.search = new URLSearchParams({
  latitude:
    String(Number(process.env.AIR_LAT ?? -2.5854)),

  longitude:
    String(Number(process.env.AIR_LON ?? 115.3846)),

  current: 'us_aqi,pm2_5,pm10',
  timezone: 'Asia/Makassar'
}).toString();

const airPool = store.mode === 'mysql'
  ? mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',

      port:
        Number(process.env.DB_PORT || 3306),

      user: process.env.DB_USER || 'root',

      password:
        process.env.DB_PASSWORD || '',

      database:
        process.env.DB_NAME || 'mediacenterhstkab',

      connectionLimit: 2,
      dateStrings: true,
      timezone: '+08:00',
      charset: 'utf8mb4'
    })
  : null;

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
  const waktu =
    String(raw.waktu_data || '').replace(' ', 'T');

  const when = new Date(
    waktu +
    (
      /(Z|[+-]\d{2}:\d{2})$/i.test(waktu)
        ? ''
        : '+08:00'
    )
  );

  const age =
    Date.now() - when.getTime();

  const [kode, label, saran] =
    category(Number(raw.aqi));

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

    sumber:
      'Open-Meteo / Copernicus CAMS',

    indeks: 'US AQI',

    jenis_data:
      'Estimasi model per jam, bukan sensor langsung atau ISPU Indonesia'
  };
}

async function liveAir() {
  const response = await fetch(
    AIR_URL,
    {
      signal: AbortSignal.timeout(8000)
    }
  );

  if (!response.ok) {
    throw new Error(
      'API AQI HTTP ' + response.status
    );
  }

  const data =
    (await response.json()).current || {};

  const aqi =
    numeric(data.us_aqi);

  if (
    aqi === null ||
    aqi < 0 ||
    aqi > 1000 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(
      String(data.time || '')
    )
  ) {
    throw new Error(
      'Respons kualitas udara tidak valid.'
    );
  }

  return airResult({
    aqi,
    pm25: data.pm2_5,
    pm10: data.pm10,
    waktu_data: data.time
  });
}

async function saveAir(item) {
  if (!airPool) {
    return false;
  }

  const time =
    item.waktu_data.replace('T', ' ') +
    (
      item.waktu_data.length === 16
        ? ':00'
        : ''
    );

  await airPool.execute(
    `INSERT INTO kualitas_udara
      (lokasi,waktu_data,aqi_us,pm25,pm10)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
      aqi_us=VALUES(aqi_us),
      pm25=VALUES(pm25),
      pm10=VALUES(pm10)`,
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
  if (!airPool) {
    return null;
  }

  const [rows] = await airPool.execute(
    `SELECT aqi_us,pm25,pm10,waktu_data
     FROM kualitas_udara
     WHERE lokasi=?
     ORDER BY waktu_data DESC
     LIMIT 1`,
    [AIR_PLACE]
  );

  if (!rows.length) {
    return null;
  }

  const row = rows[0];

  return airResult(
    {
      aqi: row.aqi_us,
      pm25: row.pm25,
      pm10: row.pm10,
      waktu_data: row.waktu_data
    },
    true,
    true
  );
}

async function getAir() {
  if (
    cachedAir &&
    Date.now() < cachedUntil
  ) {
    return airResult(
      cachedAir,
      cachedAir.arsip,
      cachedAir.tersimpan
    );
  }

  if (pendingAir) {
    return pendingAir;
  }

  pendingAir = (async () => {
    try {
      const fresh = await liveAir();

      try {
        fresh.tersimpan =
          await saveAir(fresh);
      } catch (err) {
        console.warn(
          'Simpan AQI:',
          err.message
        );
      }

      cachedAir = fresh;
      cachedUntil = Date.now() + AIR_TTL;

      return fresh;

    } catch (err) {
      console.warn(
        'Perbarui AQI:',
        err.message
      );

      let old = null;

      try {
        old = await lastAir();
      } catch (dbError) {
        console.warn(
          'Arsip AQI:',
          dbError.message
        );
      }

      if (!old && cachedAir) {
        old = airResult(
          cachedAir,
          true,
          cachedAir.tersimpan
        );
      }

      if (!old) {
        throw new Error(
          'Kualitas udara belum tersedia.'
        );
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
// 7. ROUTER PUBLIK
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
// BERANDA PUBLIK
// =========================================================

publicRouter.get(
  [
    '/',
    '/beranda',
    '/index',
    '/index.php'
  ],

  asyncRoute(async (req, res) => {
    const news =
      await store.latestNews(7);

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
// API KUALITAS UDARA PUBLIK
// =========================================================

publicRouter.get(
  '/kualitas-udara',
  (req, res) => {
    res.redirect(302, BASE + '/');
  }
);

publicRouter.get(
  '/api/kualitas-udara',

  asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    try {
      res.json(await getAir());
    } catch {
      res.status(503).json({
        error:
          'Data kualitas udara belum tersedia.'
      });
    }
  })
);

// =========================================================
// DAFTAR BERITA PUBLIK
// =========================================================

publicRouter.get(
  '/berita',

  asyncRoute(async (req, res) => {
    const q =
      cleanText(req.query.q, 100);

    const kategori =
      cleanText(req.query.kategori, 100);

    const rawYear =
      intInRange(req.query.tahun, 0, 9999);

    const tahun =
      rawYear >= 1900 && rawYear <= 2100
        ? rawYear
        : 0;

    const urut =
      req.query.urut === 'terlama'
        ? 'terlama'
        : 'terbaru';

    const page =
      intInRange(req.query.page);

    const limit = 9;

    const [
      result,
      categories,
      archiveYears
    ] = await Promise.all([
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

      totalPages: Math.max(
        1,
        Math.ceil(total / limit)
      ),

      start: total
        ? (page - 1) * limit + 1
        : 0,

      end:
        Math.min(page * limit, total),

      hasFilter: Boolean(
        q ||
        kategori ||
        tahun ||
        urut === 'terlama'
      ),

      categories,
      archiveYears
    });
  })
);

// =========================================================
// DETAIL BERITA PUBLIK
// =========================================================

publicRouter.get(
  '/detail',

  asyncRoute(async (req, res) => {
    const slug =
      cleanText(req.query.slug, 180);

    if (!slug) {
      return res.redirect(
        302,
        BASE + '/berita'
      );
    }

    const berita =
      /^[a-z\d_-]+$/i.test(slug)
        ? await store.getBySlug(slug)
        : null;

    const kategori =
      berita?.kategori || 'Informasi';

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

    if (!berita) {
      res.status(404);
    }

    renderPublic(res, 'detail', {
      pageTitle: berita
        ? berita.judul + ' | Media Center HST'
        : 'Berita tidak ditemukan | Media Center HST',

      pageDescription: berita
        ? H.excerpt(berita.isi, 155)
        : 'Informasi tidak ditemukan.',

      berita,
      kategori,

      penulis:
        berita?.penulis || 'Media Center HST',

      sumber:
        berita?.sumber || 'Belum dicantumkan',

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
    const settings =
      await store.getSettings();

    const portalUrl =
      validPortal(settings.portal_url)
        ? settings.portal_url
        : PORTAL;

    renderPublic(res, 'tentang', {
      pageTitle:
        'Tentang Media Center | Kabupaten Hulu Sungai Tengah',

      pageDescription:
        H.excerpt(
          settings.about_description,
          155
        ),

      settings,
      portalUrl
    });
  })
);




/* =========================================================
   MAINTENANCE MODE - MEDIA CENTER HST
   - Publik: halaman pemeliharaan HTTP 503
   - Admin: tetap dapat diakses
   - Ilustrasi SVG tertanam, tanpa aset eksternal
   - Letakkan SEBELUM app.use(BASE, publicRouter)
   ========================================================= */

app.use((req, res, next) => {
  if (process.env.MAINTENANCE_MODE !== '1') return next();

  const url = req.path;
  const isPublicArea = url === BASE || url.startsWith(BASE + '/');
  const isAdminArea = url === ADMIN || url.startsWith(ADMIN + '/');
  const isAsset = url.startsWith(BASE + '/assets/');

  if (!isPublicArea || isAdminArea || isAsset) return next();

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
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#0B2E4F">
  <meta name="robots" content="noindex, nofollow">

  <title>Pemeliharaan Sistem | Media Center HST</title>

  <style>
    :root {
      font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
      color: #173A55;
      background: #F3F6F9;
      font-synthesis: none;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    body {
      min-height: 100vh;
      min-height: 100dvh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .maintenance-card {
      width: min(100%, 930px);
      background: #FFFFFF;
      border: 1px solid #DDE5ED;
      border-radius: 18px;
      box-shadow: 0 18px 55px rgba(11, 46, 79, .075);
      overflow: hidden;
    }

/* Logo Pemerintah Kabupaten HST */

.identity-logo {
  width: 58px;
  height: 64px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 7px;
}

.identity-logo img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.identity {
  display: flex;
  align-items: center;
  gap: 14px;
}

    /* HEADER */

    .masthead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 22px clamp(24px, 4vw, 46px);
      border-bottom: 1px solid #E8EEF3;
    }

    .identity {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .identity-mark {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      flex: none;
      background: #0B2E4F;
      color: #FFFFFF;
      border-radius: 9px;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: -.03em;
    }

    .identity-copy strong {
      display: block;
      color: #0B2E4F;
      font-size: 14px;
      line-height: 1.3;
    }

    .identity-copy span {
      display: block;
      margin-top: 3px;
      color: #718396;
      font-size: 11px;
    }

    .status-code {
      color: #637A8C;
      border: 1px solid #DFE7EE;
      background: #F8FAFC;
      padding: 7px 10px;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .06em;
      white-space: nowrap;
    }

    /* KONTEN */

    .main-content {
      display: grid;
      grid-template-columns:
        minmax(0, 1fr) minmax(230px, 310px);
      align-items: center;
      gap: clamp(20px, 3.5vw, 52px);
      padding:
        clamp(32px, 5vw, 56px)
        clamp(24px, 4vw, 46px);
    }

    .eyebrow {
      display: flex;
      align-items: center;
      gap: 9px;
      margin: 0 0 18px;
      color: #1F6FA8;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .13em;
    }

    .eyebrow::before {
      content: "";
      width: 22px;
      height: 2px;
      background: #1F6FA8;
      border-radius: 3px;
    }

    h1 {
      max-width: 540px;
      color: #0B2E4F;
      margin: 0;
      font-size: clamp(27px, 3.7vw, 40px);
      line-height: 1.2;
      letter-spacing: -.045em;
      font-weight: 750;
    }

    .description {
      max-width: 56ch;
      margin: 18px 0 26px;
      color: #536B7F;
      font-size: 14px;
      line-height: 1.8;
    }

    /* TOMBOL */

    .actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 44px;
      padding: 11px 17px;
      border-radius: 8px;
      border: 1px solid #CEDDE9;
      color: #0B2E4F;
      background: #FFFFFF;
      font: inherit;
      font-size: 12px;
      font-weight: 700;
      text-decoration: none;
      transition:
        background .18s ease,
        border-color .18s ease;
    }

    .btn:hover {
      background: #EDF5FB;
      border-color: #A9C8DF;
    }

    .btn-primary {
      background: #0B2E4F;
      border-color: #0B2E4F;
      color: #FFFFFF;
    }

    .btn-primary:hover {
      background: #16486F;
      border-color: #16486F;
    }

    .btn:focus-visible {
      outline: 3px solid #92C5E8;
      outline-offset: 3px;
    }

    /* ILUSTRASI */

    .illustration {
      display: grid;
      place-items: center;
      min-height: 270px;
      border: 1px solid #E4ECF3;
      border-radius: 14px;
      background: #F4F8FC;
      padding: 16px;
    }

    .illustration svg {
      display: block;
      width: 100%;
      height: auto;
      max-width: 280px;
    }

    /* FOOTER */

    .card-footer {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 18px clamp(24px, 4vw, 46px);
      border-top: 1px solid #E8EEF3;
      background: #FCFDFE;
      color: #728699;
      font-size: 11px;
    }

    .card-footer strong {
      font-weight: 650;
      color: #466178;
    }

    /* RESPONSIVE */

    @media (max-width: 700px) {
      .main-content {
        grid-template-columns: 1fr;
        gap: 26px;
      }

      .illustration {
        min-height: 200px;
        max-width: 100%;
      }

      .illustration svg {
        max-width: 220px;
      }
    }

    @media (max-width: 420px) {
      body {
        padding: 12px;
      }

      .masthead {
        align-items: start;
      }

      .status-code {
        font-size: 10px;
        padding: 7px;
      }

      .identity-copy strong {
        font-size: 13px;
      }

      .identity-copy span {
        font-size: 10px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .btn {
        transition: none;
      }
    }
  </style>
</head>

<body>
  <main
    class="maintenance-card"
    aria-labelledby="maintenance-title"
  >

    <!-- IDENTITAS INSTANSI -->

    <header class="masthead">

      <div class="identity">

       
<div class="identity-logo">
  <img
    src="${BASE}/assets/img/logo-hst.png"
    alt="Lambang Kabupaten Hulu Sungai Tengah"
    width="48"
    height="56"
  >
</div>


        <div class="identity-copy">
          <strong>Media Center HST</strong>

          <span>
            Pemerintah Kabupaten Hulu Sungai Tengah
          </span>
        </div>

      </div>

      <span class="status-code">
        STATUS 503
      </span>

    </header>

    <!-- INFORMASI MAINTENANCE -->

    <div class="main-content">

      <section>

        <p class="eyebrow">
          PEMBERITAHUAN LAYANAN
        </p>

        <h1 id="maintenance-title">
          Website sedang dalam pemeliharaan
        </h1>

        <p class="description">
          Kami sedang melakukan pemeliharaan sistem
          untuk meningkatkan keandalan layanan
          informasi publik.

          Akses ke portal untuk sementara belum
          tersedia. Silakan coba kembali beberapa
          saat lagi.
        </p>

        <div class="actions">

          <a
            class="btn btn-primary"
            href="${BASE}/"
          >
            Coba Lagi
            <span aria-hidden="true">→</span>
          </a>

          <a
            class="btn"
            href="https://www.hstkab.go.id/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Portal Pemkab HST
            <span aria-hidden="true">↗</span>
          </a>

        </div>

      </section>

      <!-- GAMBAR ILUSTRASI SVG -->

      <div class="illustration">

        <svg
          viewBox="0 0 280 235"
          role="img"
          aria-labelledby="img-title img-desc"
          xmlns="http://www.w3.org/2000/svg"
        >

          <title id="img-title">
            Ilustrasi pemeliharaan website
          </title>

          <desc id="img-desc">
            Jendela halaman website dan simbol
            perkakas perawatan sistem.
          </desc>

          <!-- Jendela browser -->

          <rect
            x="20" y="26"
            width="240" height="174"
            rx="15"
            fill="#FFFFFF"
            stroke="#B8CCDC"
            stroke-width="2"
          />

          <path
            d="M20 41a15 15 0 0 1 15-15h210a15 15 0 0 1 15 15v19H20V41Z"
            fill="#E3EEF7"
          />

          <path
            d="M20 60H260"
            stroke="#B8CCDC"
            stroke-width="2"
          />

          <!-- Tombol browser -->

          <circle cx="39" cy="43" r="4" fill="#93B5CF"/>
          <circle cx="53" cy="43" r="4" fill="#93B5CF"/>
          <circle cx="67" cy="43" r="4" fill="#93B5CF"/>

          <!-- Representasi konten -->

          <rect
            x="39" y="82"
            width="88" height="10"
            rx="5"
            fill="#BDD3E4"
          />

          <rect
            x="39" y="102"
            width="124" height="7"
            rx="3.5"
            fill="#E1EAF1"
          />

          <rect
            x="39" y="116"
            width="111" height="7"
            rx="3.5"
            fill="#E1EAF1"
          />

          <rect
            x="39" y="130"
            width="74" height="7"
            rx="3.5"
            fill="#E1EAF1"
          />

          <rect
            x="39" y="155"
            width="86" height="21"
            rx="5"
            fill="#D7E8F5"
          />

          <!-- Lingkaran perkakas -->

          <circle
            cx="197" cy="129"
            r="47"
            fill="#EEF6FC"
            stroke="#C7DDED"
            stroke-width="1.5"
          />

          <!-- Ikon perkakas -->

          <path
            d="M214 105a23 23 0 0 0-28 28l-19 19a8 8 0 0 0 11 11l19-19a23 23 0 0 0 28-28l-14 14-12-3-3-12 18-10Z"
            fill="#1F6FA8"
          />

          <path
            d="M166 154l13-13"
            stroke="#FFFFFF"
            stroke-width="3"
            stroke-linecap="round"
          />

          <!-- Dudukan monitor -->

          <rect
            x="108" y="200"
            width="64" height="8"
            rx="4"
            fill="#AAC6DA"
          />

          <path
            d="M140 200v-12"
            stroke="#AAC6DA"
            stroke-width="5"
            stroke-linecap="round"
          />

          <rect
            x="92" y="210"
            width="96" height="6"
            rx="3"
            fill="#D5E4EF"
          />

        </svg>

      </div>

    </div>

    <!-- FOOTER INSTANSI -->

    <footer class="card-footer">

      <strong>
        Pemerintah Kabupaten Hulu Sungai Tengah
      </strong>

      <span>
        Media Center · Kalimantan Selatan
      </span>

    </footer>

  </main>
</body>
</html>
  `);
});


// =========================================================
// 8. ROUTER ADMIN
// =========================================================

// Dashboard hanya didaftarkan sekali, setelah middleware requireAdmin.

// =========================================================
// LOGIN ADMIN
// =========================================================

adminRouter.get(
  '/login',
  (req, res) => {
    if (req.session.adminId) {
      return res.redirect(
        302,
        ADMIN
      );
    }

    renderAdmin(res, 'login', {
      error: ''
    });
  }
);

adminRouter.post(
  '/login',
  verifyCsrf,
  loginLimit,

  asyncRoute(async (req, res) => {
    const username =
      cleanText(req.body?.username, 100);

    const password =
      typeof req.body?.password === 'string'
        ? req.body.password
        : '';

    if (password.length > 1024) {
      loginFailed(req);

      return res.status(401).render(
        'admin/login',
        {
          error:
            'Username atau password tidak sesuai.'
        }
      );
    }

    const user =
      await store.getUser(username);

    const hash = String(
      user?.password ||
      user?.password_hash ||
      DUMMY_HASH
    ).replace(/^\$2y\$/, '$2a$');

    let valid = false;

    try {
      valid = await bcrypt.compare(
        password,
        hash
      );
    } catch {
      valid = false;
    }

    if (
      !user ||
      !valid ||
      user.is_active === false ||
      user.is_active === 0
    ) {
      loginFailed(req);

      return res.status(401).render(
        'admin/login',
        {
          error:
            'Username atau password tidak sesuai.'
        }
      );
    }

    failures.delete(req.rateKey);
    ipFailures.delete(req.rateIP);

    req.session.regenerate(error => {
      if (error) {
        return res.status(500).send(
          'Sesi login gagal dibuat.'
        );
      }

      req.session.adminId = user.id;
      req.session.username = user.username;

      req.session.csrf =
        crypto.randomBytes(32).toString('hex');

      req.session.save(saveError => {
        if (saveError) {
          return res.status(500).send(
            'Sesi login gagal disimpan.'
          );
        }

        res.redirect(
          303,
          ADMIN
        );
      });
    });
  })
);

// =========================================================
// LOGOUT ADMIN
// =========================================================

adminRouter.post(
  '/logout',
  requireAdmin,
  verifyCsrf,

  (req, res, next) => {
    req.session.destroy(error => {
      if (error) {
        return next(error);
      }

      res.clearCookie(
        'mediacenter.admin.sid',
        { path: ADMIN }
      );

      res.redirect(
        303,
        ADMIN + '/login'
      );
    });
  }
);

adminRouter.get(
  '/logout',
  (req, res) => {
    res.redirect(302, ADMIN);
  }
);

// =========================================================
// REDIRECT ADMIN PHP LAMA
// =========================================================

const oldAdminPages = {
  '/index.php': ADMIN,

  '/login.php':
    ADMIN + '/login',

  '/berita.php':
    ADMIN + '/berita',

  '/tambah-berita.php':
    ADMIN + '/berita/tambah',

  '/edit-berita.php':
    ADMIN + '/berita/edit'
};

for (
  const [previous, target]
  of Object.entries(oldAdminPages)
) {
  adminRouter.get(previous, (req, res) => {
    const question =
      req.originalUrl.indexOf('?');

    const query = question < 0
      ? ''
      : req.originalUrl.slice(question);

    res.redirect(
      302,
      target + query
    );
  });
}

// =========================================================
// SEMUA ROUTE DI BAWAH WAJIB LOGIN
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

      totalBerita:
        Number(stats.totalBerita),

      totalKategori:
        Number(stats.totalKategori),

      totalGambar:
        Number(stats.totalGambar),

      updateTerakhir:
        H.waktuAdmin(stats.latest),

      persenGambar:
        Number(stats.totalBerita)
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

      isDeleted:
        req.query.status === 'deleted'
    });
  })
);

// =========================================================
// HAPUS BERITA
// =========================================================

async function deleteFromForm(req, res, returnUrl) {
  if (req.body?.action !== 'delete') {
    return res.redirect(
      303,
      returnUrl
    );
  }

  const id = intInRange(
    req.body.id,
    0,
    2147483647
  );

  const deleted = await removeNews(id);

  return res.redirect(
    303,
    returnUrl + (
      deleted
        ? '?status=deleted'
        : ''
    )
  );
}

adminRouter.post(
  '/',
  verifyCsrf,

  asyncRoute((req, res) =>
    deleteFromForm(
      req,
      res,
      ADMIN
    )
  )
);

// =========================================================
// DAFTAR BERITA ADMIN
// =========================================================

adminRouter.get(
  '/berita',

  asyncRoute(async (req, res) => {
    const q =
      cleanText(req.query.q, 100);

    const page =
      intInRange(req.query.page);

    const limit = 10;

    const { rows, total } =
      await store.listNews({
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

      status:
        cleanText(req.query.status, 20)
    });
  })
);

adminRouter.post(
  '/berita',
  verifyCsrf,

  asyncRoute((req, res) =>
    deleteFromForm(
      req,
      res,
      ADMIN + '/berita'
    )
  )
);

// =========================================================
// FORM TAMBAH BERITA
// =========================================================

adminRouter.get(
  '/berita/tambah',
  (req, res) => {
    renderAdmin(
      res,
      'tambah-berita',
      {
        data: blankNews(),
        errors: []
      }
    );
  }
);

// =========================================================
// PROSES TAMBAH BERITA
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
        image = await saveImage(
          req.file
        );

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

        console.error(
          'Tambah berita:',
          error
        );

        errors.push(
          'Berita tidak dapat disimpan. Silakan coba lagi.'
        );
      }
    }

    renderAdmin(
      res.status(422),
      'tambah-berita',
      {
        data,
        errors
      }
    );
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
// PROSES EDIT BERITA
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
          newImage = await saveImage(
            req.file
          );

          data.gambar = newImage;

        } else if (
          'hapus_gambar' in (req.body || {})
        ) {
          data.gambar = null;
        }

        await store.updateNews(
          id,
          data
        );

        if (
          old.gambar &&
          old.gambar !== data.gambar
        ) {
          await deleteImage(
            old.gambar
          );
        }

        return res.redirect(
          303,
          ADMIN + '/berita?status=updated'
        );

      } catch (error) {
        await deleteImage(newImage);

        console.error(
          'Edit berita:',
          error
        );

        errors.push(
          'Perubahan tidak dapat disimpan. Silakan coba lagi.'
        );
      }
    }

    renderAdmin(
      res.status(422),
      'edit-berita',
      {
        data,
        errors
      }
    );
  })
);

// =========================================================
// FORM PENGATURAN ADMIN
// =========================================================

adminRouter.get(
  '/pengaturan',

  asyncRoute(async (req, res) => {
    renderAdmin(
      res,
      'pengaturan',
      {
        settings:
          await store.getSettings(),

        errors: [],

        status:
          cleanText(req.query.status, 20)
      }
    );
  })
);

// =========================================================
// SIMPAN PENGATURAN ADMIN
// =========================================================

adminRouter.post(
  '/pengaturan',
  verifyCsrf,

  asyncRoute(async (req, res) => {
    const settings = {
      about_title:
        cleanText(
          req.body.about_title,
          150
        ),

      about_description:
        cleanText(
          req.body.about_description,
          1500
        ),

      portal_url:
        cleanText(
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

    if (
      settings.about_description.length < 30
    ) {
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
      return renderAdmin(
        res.status(422),
        'pengaturan',
        {
          settings,
          errors,
          status: ''
        }
      );
    }

    await store.saveSettings(settings);

    res.redirect(
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
// 9. MOUNT ROUTER
// =========================================================

app.get('/', (req, res) => {
  res.redirect(
    302,
    BASE + '/'
  );
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

  [
    '/mediacenter/admin/login',
    ADMIN + '/login'
  ],

  [
    '/mediacenter/admin/index.php',
    ADMIN
  ]
]);

for (
  const [oldPath, destination]
  of adminAliases
) {
  app.get(oldPath, (req, res) => {
    res.redirect(
      302,
      destination
    );
  });
}

// Router admin didaftarkan lebih dahulu.

app.use(
  ADMIN,
  adminRouter
);

app.use(
  BASE,
  publicRouter
);

// =========================================================
// KOMPATIBILITAS PHP LAMA
// =========================================================

const legacy = {
  '/mediacenter/index.php':
    BASE + '/',

  '/mediacenter/berita.php':
    BASE + '/berita',

  '/mediacenter/detail.php':
    BASE + '/detail',

  '/mediacenter/tentang.php':
    BASE + '/tentang'
};

for (
  const [oldPath, destination]
  of Object.entries(legacy)
) {
  app.get(
    BASE + oldPath,
    (req, res) => {
      const queryIndex =
        req.originalUrl.indexOf('?');

      const query = queryIndex < 0
        ? ''
        : req.originalUrl.slice(queryIndex);

      res.redirect(
        302,
        destination + query
      );
    }
  );
}



/* =========================================================
   GLOBAL 404 - MEDIA CENTER HST
   Professional Government Error Page

   - Desain clean dan modern
   - Logo instansi dari folder assets/img
   - Responsive desktop dan mobile
   - Navigasi publik dan administrator terpisah
   - Tanpa library CSS/JS eksternal
   ========================================================= */

app.use((req, res) => {

  // =========================================
  // KONFIGURASI AREA
  // =========================================

  const isAdmin =
    req.path === ADMIN ||
    req.path.startsWith(ADMIN + '/') ||
    req.path === '/admin' ||
    req.path.startsWith('/admin/');

  // URL navigasi
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

  // Logo dari folder img
  const logoUrl =
    BASE + '/assets/img/logo-hst.png';

  // =========================================
  // RESPONSE
  // =========================================

  res.set({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow'
  });

  return res.status(404).type('html').send(`
<!DOCTYPE html>
<html lang="id">

<head>

  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >

  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#0B2E4F">

  <title>
    404 - Halaman Tidak Ditemukan | Media Center HST
  </title>

  <style>

    /* ========================================
       DESIGN SYSTEM
    ======================================== */

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
      font-family:
        system-ui,
        -apple-system,
        "Segoe UI",
        Arial,
        sans-serif;
      color: var(--text);
    }

    /* ========================================
       MAIN CARD
    ======================================== */

    .error-card {
      width: 100%;
      max-width: 600px;
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow:
        0 4px 12px rgba(11,46,79,.025),
        0 24px 64px rgba(11,46,79,.07);
    }

    /* ========================================
       HEADER INSTANSI
    ======================================== */

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
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 5px;
      border: 1px solid #E5ECF2;
      border-radius: 10px;
      background: #FFFFFF;
    }

    .brand-logo img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .brand-info {
      min-width: 0;
    }

    .brand-info .government {
      display: block;
      color: var(--muted);
      font-size: 10px;
      font-weight: 750;
      letter-spacing: .075em;
      line-height: 1.5;
      text-transform: uppercase;
    }

    .brand-info .name {
      display: block;
      margin-top: 4px;
      color: var(--navy);
      font-size: 17px;
      font-weight: 800;
      line-height: 1.3;
    }

    .brand-info .subname {
      display: block;
      margin-top: 2px;
      color: var(--blue);
      font-size: 11px;
      font-weight: 600;
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
      letter-spacing: .035em;
    }

    /* ========================================
       ERROR CONTENT
    ======================================== */

    .card-content {
      padding: 40px 38px 38px;
      text-align: center;
    }

    /* Icon container */

    .error-icon {
      width: 78px;
      height: 78px;
      margin: 0 auto 23px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #EDF5FB;
      border: 1px solid #DAE9F5;
      border-radius: 19px;
      color: var(--blue);
    }

    .error-icon svg {
      width: 36px;
      height: 36px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* Error code */

    .error-code {
      margin: 0 0 8px;
      color: var(--blue);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    /* Error title */

    h1 {
      margin: 0;
      color: var(--navy);
      font-size: clamp(24px, 4vw, 32px);
      line-height: 1.3;
      letter-spacing: -.035em;
      font-weight: 800;
    }

    .description {
      max-width: 430px;
      margin: 15px auto 29px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.8;
    }

    /* ========================================
       BUTTONS
    ======================================== */

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
      gap: 10px;
      padding: 11px 19px;
      border-radius: 8px;
      border: 1px solid #D4E1EB;
      background: #FFFFFF;
      color: var(--navy);
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.3;
      text-decoration: none;
      cursor: pointer;
      transition:
        background .2s ease,
        border-color .2s ease,
        transform .2s ease;
    }

    .btn:hover {
      background: #F0F6FB;
      border-color: #B5CDDF;
      transform: translateY(-1px);
    }

    .btn-primary {
      background: var(--navy);
      border-color: var(--navy);
      color: #FFFFFF;
    }

    .btn-primary:hover {
      background: #174569;
      border-color: #174569;
    }

    .btn svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    .btn:focus-visible {
      outline: 3px solid #8BC7EF;
      outline-offset: 3px;
    }

    /* ========================================
       FOOTER CARD
    ======================================== */

    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding: 17px 30px;
      border-top: 1px solid var(--border);
      background: #FCFDFE;
    }

    .footer-left,
    .footer-right {
      margin: 0;
      color: #788C9C;
      font-size: 11px;
      line-height: 1.5;
    }

    .footer-left {
      font-weight: 600;
    }

    .footer-right {
      color: var(--blue);
      font-weight: 700;
    }

    /* ========================================
       MOBILE RESPONSIVE
    ======================================== */

    @media (max-width: 600px) {

      body {
        padding: 14px;
      }

      .card-header {
        padding: 19px 18px;
      }

      .brand {
        gap: 10px;
      }

      .brand-logo {
        width: 46px;
        height: 50px;
      }

      .brand-info .government {
        font-size: 9px;
      }

      .brand-info .name {
        font-size: 15px;
      }

      .status-label {
        font-size: 10px;
        padding: 7px 8px;
      }

      .card-content {
        padding: 33px 22px;
      }

      .error-icon {
        width: 68px;
        height: 68px;
        margin-bottom: 20px;
      }

      .error-icon svg {
        width: 32px;
        height: 32px;
      }

      .description {
        font-size: 13px;
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

    @media (prefers-reduced-motion: reduce) {
      .btn {
        transition: none;
      }
    }

  </style>

</head>

<body>

  <main
    class="error-card"
    aria-labelledby="error-title"
  >

    <!-- ======================================
         HEADER PEMERINTAH
    ======================================= -->

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

        <div class="brand-info">

          <span class="government">
            Pemerintah Kabupaten
          </span>

          <strong class="name">
            Hulu Sungai Tengah
          </strong>

          <span class="subname">
            Media Center HST
          </span>

        </div>

      </div>

      <span class="status-label">
        ERROR 404
      </span>

    </header>


    <!-- ======================================
         INFORMASI ERROR
    ======================================= -->

    <section class="card-content">

      <!-- ICON ERROR -->

      <div class="error-icon" aria-hidden="true">

        <svg
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >

          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
          />

          <path d="M14 2v6h6"/>

          <path d="M8.5 13.5l7 7" transform="translate(0 -2)"/>

          <path d="M15.5 13.5l-7 7" transform="translate(0 -2)"/>

        </svg>

      </div>

      <!-- STATUS -->

      <p class="error-code">
        404 · PAGE NOT FOUND
      </p>

      <!-- JUDUL -->

      <h1 id="error-title">
        Halaman Tidak Ditemukan
      </h1>

      <!-- DESKRIPSI -->

      <p class="description">
        Maaf, halaman yang Anda cari tidak tersedia,
        telah dipindahkan, atau alamat yang dimasukkan
        tidak sesuai.

        Silakan kembali ke halaman utama atau
        gunakan menu navigasi yang tersedia.
      </p>

      <!-- TOMBOL NAVIGASI -->

      <nav
        class="actions"
        aria-label="Navigasi halaman kesalahan"
      >

        <a
          class="btn btn-primary"
          href="${primaryUrl}"
        >

          ${primaryText}

          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14"/>
            <path d="m13 6 6 6-6 6"/>
          </svg>

        </a>

        <a
          class="btn"
          href="${secondaryUrl}"
        >
          ${secondaryText}
        </a>

      </nav>

    </section>


    <!-- ======================================
         FOOTER
    ======================================= -->

    <footer class="card-footer">

      <p class="footer-left">
        © Media Center Kabupaten Hulu Sungai Tengah
      </p>

      <p class="footer-right">
        Layanan Informasi Pemerintah Daerah
      </p>

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
    console.error(
      'Kesalahan server:',
      err
    );
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

  res.status(code).send(
    'Permintaan tidak dapat diproses.'
  );
});

// =========================================================
// MENJALANKAN SERVER
// =========================================================

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `Media Center HST v5: http://localhost:${PORT}${BASE}/`
    );

    console.log(
      `Admin: http://localhost:${PORT}${ADMIN}/login`
    );

    console.log(
      `Database: ${store.mode}`
    );
  });
}

module.exports = app;
