'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');
const store = require('../lib/repository');

async function main() {
  const [usernameArg, passwordArg] = process.argv.slice(2);
  const username = String(usernameArg || '').trim();
  const password = String(passwordArg || '');

  if (!username || !password) {
    console.error('Penggunaan: npm run seed:admin -- <username> <password>');
    process.exitCode = 1;
    return;
  }

  if (username.length > 100 || password.length < 12 || password.length > 1024) {
    console.error('Username maksimal 100 karakter; password harus 12–1024 karakter.');
    process.exitCode = 1;
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await store.createUser(username, hash);
  console.log(`Administrator "${username}" berhasil dibuat.`);
}

main().catch(error => {
  console.error('Gagal membuat administrator:', error.message);
  process.exitCode = 1;
});
