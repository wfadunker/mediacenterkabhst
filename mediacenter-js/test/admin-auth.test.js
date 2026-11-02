'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

test('dashboard admin mengarahkan pengguna anonim ke halaman login', async t => {
  const server = app.listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const response = await fetch(
    `http://127.0.0.1:${address.port}/mediacenter-demo/admin`,
    { redirect: 'manual' }
  );

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get('location'),
    '/mediacenter-demo/admin/login'
  );
});
