'use strict';

const session = require('express-session');
const mysql = require('mysql2/promise');

class MySQLSessionStore extends session.Store {
  constructor(options = {}) {
    super();

    const ca = String(
      options.ssl?.ca || process.env.DB_SSL_CA || ''
    ).replace(/\\n/g, '\n').trim();

    if (!ca) {
      throw new Error('DB_SSL_CA belum dikonfigurasi.');
    }

    this.expiration = Number(
      options.expiration || 8 * 60 * 60 * 1000
    );

    this.pool = mysql.createPool({
      host: options.host || process.env.DB_HOST,
      port: Number(options.port || process.env.DB_PORT || 4000),
      user: options.user || process.env.DB_USER,
      password: options.password ?? process.env.DB_PASSWORD,
      database: options.database || process.env.DB_NAME,

      // WAJIB untuk TiDB Cloud
      ssl: {
        ca,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
      },

      waitForConnections: true,
      connectionLimit: Number(options.connectionLimit || 1),
      queueLimit: 0,
      connectTimeout: 15000,
      charset: 'utf8mb4',
      timezone: '+08:00'
    });

    this.ready = null;
  }

  async ensureReady() {
    if (!this.ready) {
      this.ready = this.pool.execute(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
          session_id VARCHAR(128) NOT NULL,
          expires BIGINT UNSIGNED NOT NULL,
          data MEDIUMTEXT NOT NULL,
          PRIMARY KEY (session_id),
          KEY idx_admin_sessions_expires (expires)
        ) ENGINE=InnoDB
          DEFAULT CHARSET=utf8mb4
          COLLATE=utf8mb4_unicode_ci
      `).catch(error => {
        this.ready = null;
        throw error;
      });
    }

    return this.ready;
  }

  execute(callback, operation) {
    const promise = Promise.resolve().then(operation);

    if (typeof callback === 'function') {
      promise.then(
        result => callback(null, result),
        error => callback(error)
      );
    }

    return promise;
  }

  get(sid, callback) {
    return this.execute(callback, async () => {
      await this.ensureReady();

      const [result] = await this.pool.execute(
        `SELECT data, expires
         FROM admin_sessions
         WHERE session_id = ?
         LIMIT 1`,
        [sid]
      );

      if (!result.length) return null;

      const row = result[0];

      if (Number(row.expires) <= Date.now()) {
        await this.destroy(sid);
        return null;
      }

      return JSON.parse(row.data);
    });
  }

  set(sid, sess, callback) {
    return this.execute(callback, async () => {
      await this.ensureReady();

      const cookieExpiry = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + this.expiration;

      const expires = Number.isFinite(cookieExpiry)
        ? cookieExpiry
        : Date.now() + this.expiration;

      await this.pool.execute(
        `INSERT INTO admin_sessions
          (session_id, expires, data)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
          expires = VALUES(expires),
          data = VALUES(data)`,
        [sid, expires, JSON.stringify(sess)]
      );
    });
  }

  destroy(sid, callback) {
    return this.execute(callback, async () => {
      await this.ensureReady();

      await this.pool.execute(
        'DELETE FROM admin_sessions WHERE session_id = ?',
        [sid]
      );
    });
  }

  touch(sid, sess, callback) {
    return this.execute(callback, async () => {
      await this.ensureReady();

      const cookieExpiry = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + this.expiration;

      const expires = Number.isFinite(cookieExpiry)
        ? cookieExpiry
        : Date.now() + this.expiration;

      await this.pool.execute(
        `UPDATE admin_sessions
         SET expires = ?
         WHERE session_id = ?`,
        [expires, sid]
      );
    });
  }

  length(callback) {
    return this.execute(callback, async () => {
      await this.ensureReady();

      const [result] = await this.pool.execute(
        'SELECT COUNT(*) AS total FROM admin_sessions WHERE expires > ?',
        [Date.now()]
      );

      return Number(result[0].total);
    });
  }

  clear(callback) {
    return this.execute(callback, async () => {
      await this.ensureReady();

      await this.pool.execute(
        'DELETE FROM admin_sessions'
      );
    });
  }

  close(callback) {
    return this.execute(callback, async () => {
      await this.pool.end();
    });
  }
}

module.exports = MySQLSessionStore;