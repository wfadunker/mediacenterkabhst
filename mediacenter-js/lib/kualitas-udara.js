
'use strict';

const mysql = require('mysql2/promise');

const LOKASI = 'Barabai, Hulu Sungai Tengah';

const API_URL =
  'https://air-quality-api.open-meteo.com/v1/air-quality' +
  '?latitude=-2.5854&longitude=115.3846' +
  '&current=us_aqi,pm2_5,pm10' +
  '&timezone=Asia%2FMakassar';

const TTL_MS = 10 * 60 * 1000;

const pool = (process.env.DB_MODE || 'json').toLowerCase() === 'mysql'
  ? mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'mediacenterhstkab',
      connectionLimit: 3,
      dateStrings: true
    })
  : null;

let cache = null;
let expiresAt = 0;
let inFlight = null;

function kategoriAqi(value) {
  if (value <= 50) {
    return {
      kode: 'baik',
      label: 'Baik',
      saran: 'Kualitas udara baik untuk aktivitas luar ruangan.'
    };
  }

  if (value <= 100) {
    return {
      kode: 'sedang',
      label: 'Sedang',
      saran: 'Umumnya dapat beraktivitas. Orang yang sangat sensitif perlu memperhatikan gejala.'
    };
  }

  if (value <= 150) {
    return {
      kode: 'sensitif',
      label: 'Tidak Sehat untuk Kelompok Sensitif',
      saran: 'Anak-anak, lansia, dan penderita penyakit pernapasan sebaiknya mengurangi aktivitas berat di luar.'
    };
  }

  if (value <= 200) {
    return {
      kode: 'tidak-sehat',
      label: 'Tidak Sehat',
      saran: 'Kurangi aktivitas berat di luar ruangan, terutama kelompok sensitif.'
    };
  }

  if (value <= 300) {
    return {
      kode: 'sangat-tidak-sehat',
      label: 'Sangat Tidak Sehat',
      saran: 'Batasi kegiatan luar ruangan dan ikuti informasi kesehatan setempat.'
    };
  }

  return {
    kode: 'berbahaya',
    label: 'Berbahaya',
    saran: 'Hindari aktivitas luar ruangan yang tidak mendesak dan ikuti arahan petugas.'
  };
}

function angka(input) {
  return input !== null &&
    input !== undefined &&
    Number.isFinite(Number(input))
    ? Number(input)
    : null;
}

function bentukData({
  aqi,
  pm25,
  pm10,
  waktuData,
  tersimpan = false,
  arsip = false
}) {
  return {
    lokasi: LOKASI,
    aqi,
    pm25,
    pm10,
    waktu_data: waktuData,
    tersimpan,
    arsip,
    ...kategoriAqi(aqi),
    sumber: 'Open-Meteo / Copernicus CAMS',
    indeks: 'US AQI',
    jenis_data: 'Estimasi model per jam'
  };
}

async function ambilDariApi() {
  const response = await fetch(API_URL, {
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`Layanan udara HTTP ${response.status}`);
  }

  const json = await response.json();
  const current = json.current || {};

  const aqi = angka(current.us_aqi);
  const waktuData = String(current.time || '');

  if (
    aqi === null ||
    aqi < 0 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(waktuData)
  ) {
    throw new Error('Data kualitas udara tidak valid.');
  }

  return bentukData({
    aqi,
    pm25: angka(current.pm2_5),
    pm10: angka(current.pm10),
    waktuData
  });
}

async function simpanKeMysql(data) {
  if (!pool) return false;

  const waktu =
    data.waktu_data.replace('T', ' ') +
    (data.waktu_data.length === 16 ? ':00' : '');

  await pool.execute(
    `INSERT INTO kualitas_udara
       (lokasi, waktu_data, aqi_us, pm25, pm10)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       aqi_us = VALUES(aqi_us),
       pm25 = VALUES(pm25),
       pm10 = VALUES(pm10)`,
    [
      data.lokasi,
      waktu,
      data.aqi,
      data.pm25,
      data.pm10
    ]
  );

  return true;
}

async function ambilArsip() {
  if (!pool) return null;

  const [rows] = await pool.execute(
    `SELECT aqi_us, pm25, pm10, waktu_data
     FROM kualitas_udara
     WHERE lokasi = ?
     ORDER BY waktu_data DESC
     LIMIT 1`,
    [LOKASI]
  );

  if (!rows.length) return null;

  const d = rows[0];

  return bentukData({
    aqi: Number(d.aqi_us),
    pm25: angka(d.pm25),
    pm10: angka(d.pm10),
    waktuData: String(d.waktu_data).replace(' ', 'T'),
    tersimpan: true,
    arsip: true
  });
}

async function getKualitasUdara() {
  if (cache && Date.now() < expiresAt) {
    return cache;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const data = await ambilDariApi();

      try {
        data.tersimpan = await simpanKeMysql(data);
      } catch (error) {
        console.error(
          'Gagal menyimpan kualitas udara:',
          error.message
        );
      }

      cache = data;
      expiresAt = Date.now() + TTL_MS;

      return data;
    } catch (error) {
      console.error(
        'Gagal mengambil kualitas udara:',
        error.message
      );

      try {
        const last = await ambilArsip();

        if (last) {
          cache = last;
          expiresAt = Date.now() + 60 * 1000;
          return last;
        }
      } catch (dbError) {
        console.error(
          'Gagal membaca arsip:',
          dbError.message
        );
      }

      cache = null;
      throw new Error(
        'Data kualitas udara saat ini tidak tersedia.'
      );
    }
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

module.exports = {
  getKualitasUdara,
  kategoriAqi
};
