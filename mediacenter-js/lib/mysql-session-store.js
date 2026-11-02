'use strict';

/**
 * Persistent MySQL session store for express-session.
 * Uses the project's existing mysql2 dependency, so no additional
 * production dependency is required.
 */
const session = require('express-session');
const mysql = require('mysql2/promise');

const TABLE = 'admin_sessions';

class MySQLSessionStore extends session.Store {
  constructor(options = {}) {
    super();

    if (!options.database) {
      throw new Error('DB_NAME wajib diisi untuk MySQL session store.');
    }

    this.expiration = Number(options.expiration) || 8 * 60 * 60 * 1000;
    this.pool = mysql.createPool({
      host: options.host || '127.0.0.1',
      port: Number(options.port || 3306),
      user: options.user || 'root',
      password: options.password || '',
      database: options.database,
      waitForConnections: true,
      connectionLimit: Number(options.connectionLimit) || 5,
      queueLimit: 0,
      connectTimeout: 10000,
      enableKeepAlive: true,
      charset: 'utf8mb4'
    });

    // Lazy DDL: aplikasi tidak membuka koneksi DB hanya karena modul di-load.
    this.ready = null;
    this.writeCount = 0;
  }

  ensureReady() {
    if (!this.ready) {
      this.ready = this.pool.execute(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (
          session_id VARCHAR(128) NOT NULL,
          expires BIGINT UNSIGNED NOT NULL,
          data MEDIUMTEXT NOT NULL,
          PRIMARY KEY (session_id),
          KEY idx_admin_sessions_expires (expires)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      ).then(() => true);
    }

    return this.ready;
  }

  run(callback, operation) {
    Promise.resolve()
      .then(() => this.ensureReady())
      .then(operation)
      .then(
        result => {
          if (typeof callback === 'function') callback(null, result);
        },
        error => {
          if (typeof callback === 'function') callback(error);
          else this.emit('error', error);
        }
      );
  }

  expiryFor(sessionData) {
    const cookie = sessionData && sessionData.cookie || {};
    const cookieExpiry = cookie.expires
      ? new Date(cookie.expires).getTime()
      : Date.now() + (Number(cookie.originalMaxAge) || this.expiration);

    return Number.isFinite(cookieExpiry) && cookieExpiry > Date.now()
      ? Math.trunc(cookieExpiry)
      : Date.now() + this.expiration;
  }

  get(sessionId, callback) {
    this.run(callback, async () => {
      const now = Date.now();
      const [rows] = await this.pool.execute(
        `SELECT data FROM ${TABLE}
         WHERE session_id = ? AND expires > ?
         LIMIT 1`,
        [sessionId, now]
      );

      if (!rows.length) {
        await this.pool.execute(
          `DELETE FROM ${TABLE} WHERE session_id = ? AND expires <= ?`,
          [sessionId, now]
        );
        return null;
      }

      try {
        return JSON.parse(rows[0].data);
      } catch {
        await this.destroyAsync(sessionId);
        return null;
      }
    });
  }

  set(sessionId, sessionData, callback) {
    this.run(callback, async () => {
      const payload = JSON.stringify(sessionData);
      const expires = this.expiryFor(sessionData);

      await this.pool.execute(
        `INSERT INTO ${TABLE} (session_id, expires, data)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           expires = VALUES(expires),
           data = VALUES(data)`,
        [sessionId, expires, payload]
      );

      this.writeCount += 1;
      if (this.writeCount >= 100) {
        this.writeCount = 0;
        await this.pool.execute(
          `DELETE FROM ${TABLE} WHERE expires <= ?`,
          [Date.now()]
        );
      }
    });
  }

  destroyAsync(sessionId) {
    return this.pool.execute(
      `DELETE FROM ${TABLE} WHERE session_id = ?`,
      [sessionId]
    );
  }

  destroy(sessionId, callback) {
    this.run(callback, () => this.destroyAsync(sessionId));
  }

  touch(sessionId, sessionData, callback) {
    this.run(callback, async () => {
      await this.pool.execute(
        `UPDATE ${TABLE} SET expires = ? WHERE session_id = ?`,
        [this.expiryFor(sessionData), sessionId]
      );
    });
  }

  clearExpired(callback) {
    this.run(callback, async () => {
      const [result] = await this.pool.execute(
        `DELETE FROM ${TABLE} WHERE expires <= ?`,
        [Date.now()]
      );
      return result.affectedRows;
    });
  }

  close() {
    return this.pool.end();
  }
}

module.exports = MySQLSessionStore;
