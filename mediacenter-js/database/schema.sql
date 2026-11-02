-- Skema instalasi baru untuk Media Center Kabupaten Hulu Sungai Tengah.
-- Jangan jalankan untuk mereset database produksi yang sudah berisi data.
-- Semua tabel menggunakan CREATE TABLE IF NOT EXISTS (tanpa DROP/DELETE data).

CREATE DATABASE IF NOT EXISTS mediacenterhstkab
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mediacenterhstkab;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS berita (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  judul VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  isi LONGTEXT NOT NULL,
  gambar VARCHAR(255) DEFAULT NULL,
  kategori VARCHAR(100) NOT NULL,
  tanggal DATE NOT NULL,
  penulis VARCHAR(150) DEFAULT NULL,
  sumber VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_berita_tanggal (tanggal),
  INDEX idx_berita_kategori (kategori),
  INDEX idx_berita_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pengaturan (
  kunci VARCHAR(100) PRIMARY KEY,
  nilai TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS kualitas_udara (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lokasi VARCHAR(150) NOT NULL,
  waktu_data DATETIME NOT NULL,
  aqi_us DECIMAL(8,2) NOT NULL,
  pm25 DECIMAL(8,2) DEFAULT NULL,
  pm10 DECIMAL(8,2) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kualitas_udara_lokasi_waktu (lokasi, waktu_data),
  KEY idx_kualitas_udara_waktu (waktu_data)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id VARCHAR(128) NOT NULL,
  expires BIGINT UNSIGNED NOT NULL,
  data MEDIUMTEXT NOT NULL,
  PRIMARY KEY (session_id),
  KEY idx_admin_sessions_expires (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
