// Who gets in, and what they may do once they are.
//
// These run the real application - the same middleware in the same order as
// production - against a throwaway database, over real HTTP. The only thing
// swapped is where Google's signing keys come from: the tests sign their own
// sign-in tokens with a key made here, so they can also sign bad ones.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

if (!process.env.DATABASE_URL) {
  process.env.PGDATA_DIR = process.env.TEST_PGDATA_DIR || path.join(__dirname, '..', 'db', 'test-pgdata-access');
  fs.rmSync(process.env.PGDATA_DIR, { recursive: true, force: true });
  fs.rmSync(`${process.env.PGDATA_DIR}.lock`, { force: true });
}
process.env.UPLOAD_DIR = path.join(__dirname, '..', 'db', 'test-pgdata-access-uploads');
process.env.BACKUP_DIR = path.join(__dirname, '..', 'db', 'test-pgdata-access-backups');
const db = require('../db');
const { migrate } = require('../db/migrate');
const app = require('../index');
delete process.env.AUTH_REQUIRED;
delete process.env.OWNER_EMAIL;
delete process.env.CORS_ORIGIN;
delete process.env.NODE_ENV;
const firebaseToken = require('../lib/auth/firebaseToken');
const { internalToken } = require('../lib/auth/context');
const { limiters } = require('../middleware/rateLimit');
const sqlRunner = require('../lib/dbconsole/sqlRunner');

const PROJECT = firebaseToken.projectId();
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_ID = 'test-key-1';
const stranger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

let server;
let base;

/** A sign-in token the way Firebase makes one, with anything overridable. */
function idToken(uid, email, overrides = {}, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      sub: uid,
      email,
      email_verified: true,
      name: email.split('@')[0],
      iat: now,
      exp: now + 3600,
      auth_time: now,
      ...overrides,
    },
    options.key || privateKey,
    { algorithm: options.algorithm || 'RS256', keyid: options.keyId || KEY_ID }
  );
}

/** A browser, as far as the API can tell: it keeps its cookie and its anti-forgery token. */
function browser() {
  const jar = { cookie: null, csrf: null, user: null };
  async function request(method, url, { body, headers = {}, csrf = true, form } = {}) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(jar.cookie ? { Cookie: jar.cookie } : {}),
        ...(csrf && jar.csrf && method !== 'GET' ? { 'X-CSRF-Token': jar.csrf } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: form || (body ? JSON.stringify(body) : undefined),
    });
    const setCookie = response.headers.getSetCookie?.() || [];
    for (const line of setCookie) {
      if (line.startsWith('docdesk_session=')) {
        const value = line.split(';')[0];
        jar.cookie = value === 'docdesk_session=' ? null : value;
        jar.lastSetCookie = line;
      }
    }
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON: a download
    }
    return { status: response.status, body: json, text, headers: response.headers };
  }
  return {
    jar,
    get: (url, options) => request('GET', url, options),
    post: (url, body, options) => request('POST', url, { body, ...options }),
    put: (url, body, options) => request('PUT', url, { body, ...options }),
    del: (url, options) => request('DELETE', url, options),
    async signIn(uid, email) {
      const result = await request('POST', '/api/auth/session', { body: { idToken: idToken(uid, email) } });
      if (result.body?.csrfToken) jar.csrf = result.body.csrfToken;
      jar.user = result.body?.user || null;
      return result;
    },
  };
}

const owner = browser();
const staff = browser();

test.before(async () => {
  await db.ready;
  await migrate();
  firebaseToken.useKeySource(async () => ({ keys: { [KEY_ID]: publicKey.export({ type: 'spki', format: 'pem' }) }, maxAgeMs: 3_600_000 }));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  process.env.PORT = String(server.address().port);
  base = `http://127.0.0.1:${process.env.PORT}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
  fs.rmSync(process.env.BACKUP_DIR, { recursive: true, force: true });
});

test.beforeEach(() => {
  for (const limiter of Object.values(limiters)) limiter.reset();
});

// --- the front door ------------------------------------------------------------

test('without a session, the API answers nothing but "sign in"', async () => {
  const anonymous = browser();
  for (const url of ['/api/products', '/api/customers', '/api/settings', '/api/stats', '/api/db/overview', '/api/export/customers', '/api/files/1/content', '/api/team']) {
    const result = await anonymous.get(url);
    assert.equal(result.status, 401, url);
    assert.equal(result.body.code, 'signed_out', url);
  }
  const write = await anonymous.post('/api/customers', { name: 'Nobody' });
  assert.equal(write.status, 401);
});

test('the health check is open, and asking who you are is never an error', async () => {
  const anonymous = browser();
  assert.equal((await anonymous.get('/api/health')).status, 200);
  const who = await anonymous.get('/api/auth/session');
  assert.equal(who.status, 200);
  assert.equal(who.body.user, null);
});

test('a sign-in token is only believed if Google signed it, for this project, and it is current', async () => {
  const email = 'forger@example.com';
  const attempts = {
    'signed by somebody else': idToken('u-x', email, {}, { key: stranger.privateKey }),
    'for another project': idToken('u-x', email, { aud: 'some-other-project' }),
    'from another issuer': idToken('u-x', email, { iss: 'https://securetoken.google.com/some-other-project' }),
    'expired': idToken('u-x', email, { iat: 1_000_000, exp: 1_000_100 }),
    'an unknown key': idToken('u-x', email, {}, { keyId: 'never-heard-of-it' }),
    'no subject': idToken('', email),
    // The classic: sign with HMAC using the public key as the secret, and hope
    // the verifier takes the algorithm from the token.
    'the wrong algorithm': jwt.sign(
      { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'u-x', exp: Math.floor(Date.now() / 1000) + 600 },
      publicKey.export({ type: 'spki', format: 'pem' }),
      { algorithm: 'HS256', keyid: KEY_ID }
    ),
    'unsigned': `${Buffer.from('{"alg":"none","kid":"test-key-1"}').toString('base64url')}.${Buffer.from(JSON.stringify({ aud: PROJECT, sub: 'u-x' })).toString('base64url')}.`,
    'not a token': 'hello',
  };
  for (const [label, token] of Object.entries(attempts)) {
    limiters.signIn.reset();
    const result = await browser().post('/api/auth/session', { idToken: token });
    assert.equal(result.status, 401, label);
  }
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  assert.equal(rows[0].n, 0, 'none of them created an account');
});

test('the first person to sign in becomes the owner, and gets a cookie no script can read', async () => {
  const result = await owner.signIn('uid-owner', 'owner@shop.test');
  assert.equal(result.status, 201);
  assert.equal(result.body.user.role, 'owner');
  assert.equal(result.body.user.status, 'active');

  const cookie = owner.jar.lastSetCookie;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/api/i);

  assert.equal((await owner.get('/api/products')).status, 200);
  // Nothing in the reply is the session itself.
  assert.ok(!JSON.stringify(result.body).includes(owner.jar.cookie.split('=')[1]));
});

test('the database holds a hash of the session, never the session', async () => {
  const token = owner.jar.cookie.split('=')[1];
  const { rows } = await db.query('SELECT token_hash FROM sessions');
  assert.ok(rows.length >= 1);
  for (const row of rows) assert.notEqual(row.token_hash, token);
  assert.ok(rows.some((row) => row.token_hash === crypto.createHash('sha256').update(token).digest('hex')));
});

// --- cross-site request forgery -----------------------------------------------

test('a change needs the anti-forgery token as well as the cookie', async () => {
  const forged = await owner.post('/api/customers', { name: 'Forged' }, { csrf: false });
  assert.equal(forged.status, 403);
  assert.equal(forged.body.code, 'csrf');

  const wrong = await owner.post('/api/customers', { name: 'Forged' }, { csrf: false, headers: { 'X-CSRF-Token': 'guess' } });
  assert.equal(wrong.status, 403);

  const real = await owner.post('/api/customers', { name: 'Asha Rao', phone: '9876500001' });
  assert.equal(real.status, 201);

  const { rows } = await db.query("SELECT count(*)::int AS n FROM customers WHERE name = 'Forged'");
  assert.equal(rows[0].n, 0);
});

test('a change sent from another website is refused before anything else is looked at', async () => {
  const result = await owner.post('/api/customers', { name: 'Cross-site' }, { headers: { Origin: 'https://evil.example' } });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'origin');

  // And that site is not told it may read answers either.
  const read = await owner.get('/api/customers', { headers: { Origin: 'https://evil.example' } });
  assert.equal(read.headers.get('access-control-allow-origin'), null);

  // The app's own address in development is on the list.
  const ours = await owner.post('/api/customers', { name: 'Same site' }, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(ours.status, 201);
});

test('a request addressed to another name is not answered at all', async () => {
  // DNS rebinding: a site points its own domain at 127.0.0.1.
  const status = await new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port: process.env.PORT, path: '/api/health', headers: { Host: 'evil.example:5000' } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      }
    );
    request.on('error', reject);
    request.end();
  });
  assert.equal(status, 421);
});

// --- roles -----------------------------------------------------------------------

test('everyone after the first waits to be let in', async () => {
  const result = await staff.signIn('uid-staff', 'staff@shop.test');
  assert.equal(result.status, 201);
  assert.equal(result.body.user.status, 'pending');

  const blocked = await staff.get('/api/products');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'pending');

  // They can still ask who they are, which is how the waiting screen knows.
  assert.equal((await staff.get('/api/auth/session')).body.user.status, 'pending');
});

test('the owner lets them in, and it takes effect on their next request', async () => {
  const team = await owner.get('/api/team');
  assert.equal(team.status, 200);
  const member = team.body.items.find((u) => u.email === 'staff@shop.test');
  assert.ok(member);
  staff.jar.id = member.id;

  const approved = await owner.put(`/api/team/${member.id}`, { status: 'active' });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.role, 'staff');

  assert.equal((await staff.get('/api/products')).status, 200);
});

test('staff do the day-to-day work and nothing above it', async () => {
  // Their own work: fine.
  const customer = await staff.post('/api/customers', { name: 'Walk-in Wendy' });
  assert.equal(customer.status, 201);
  assert.equal((await staff.get('/api/reports/summary')).status, 200);

  // A manager's or the owner's: refused, whatever the route.
  const refused = [
    ['PUT', '/api/settings', { business_name: 'Mine now' }],
    ['GET', '/api/db/overview'],
    ['GET', '/api/db/tables/customers/rows'],
    ['POST', '/api/db/query', { sql: 'SELECT * FROM customers' }],
    ['GET', '/api/db/backups'],
    ['GET', '/api/db/export.sql'],
    ['POST', '/api/db/restore', { name: 'x', confirm: 'RESTORE' }],
    ['POST', '/api/db/maintenance', { action: 'vacuum' }],
    ['DELETE', '/api/dev/seed'],
    ['DELETE', '/api/sales/1'],
    ['POST', '/api/services', { name: 'Free haircuts' }],
    ['PUT', '/api/hours', { hours: [] }],
    ['PUT', '/api/ai/overrides', { daily_token_cap: 0 }],
    ['GET', '/api/team'],
    ['PUT', `/api/team/${staff.jar.id}`, { role: 'owner' }],
  ];
  for (const [method, url, body] of refused) {
    const result = method === 'GET' ? await staff.get(url)
      : method === 'DELETE' ? await staff.del(url)
        : method === 'PUT' ? await staff.put(url, body) : await staff.post(url, body);
    assert.equal(result.status, 403, `${method} ${url}`);
    assert.equal(result.body.code, 'forbidden', `${method} ${url}`);
  }

  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'business_name'");
  assert.notEqual(rows[0]?.value, 'Mine now');
});

test('a manager may look inside the database but not change it from there', async () => {
  await owner.put(`/api/team/${staff.jar.id}`, { role: 'manager' });

  assert.equal((await staff.get('/api/db/overview')).status, 200);
  const read = await staff.post('/api/db/query', { sql: 'SELECT count(*) FROM customers' });
  assert.equal(read.status, 200);

  const write = await staff.post('/api/db/query', { sql: "UPDATE customers SET name = 'x'", allowWrite: true });
  assert.equal(write.status, 403);
  assert.equal(write.body.code, 'forbidden');
  assert.equal((await staff.get('/api/db/export.sql')).status, 403);
  assert.equal((await staff.put('/api/settings', { business_name: 'Corner Stationers' })).status, 200);

  await owner.put(`/api/team/${staff.jar.id}`, { role: 'staff' });
  assert.equal((await staff.get('/api/db/overview')).status, 403, 'demoted on the very next request');
});

test('nobody can change their own access, and there is always an owner', async () => {
  const me = (await owner.get('/api/auth/session')).body.user;
  assert.equal((await owner.put(`/api/team/${me.id}`, { role: 'staff' })).status, 400);
  assert.equal((await owner.del(`/api/team/${me.id}`)).status, 400);

  // The rule is the database's, so it holds for a change made behind the API's back too.
  await assert.rejects(db.query("UPDATE users SET role = 'staff' WHERE role = 'owner'"), /at least one owner/);
  await assert.rejects(db.query("DELETE FROM users WHERE role = 'owner'"), /at least one owner/);
});

test('saying you are the receptionist does not make it so', async () => {
  const created = await owner.post('/api/customers', { name: 'Audit Trail' }, { headers: { 'x-docdesk-actor': 'receptionist' } });
  assert.equal(created.status, 201);
  const { rows } = await db.query(
    "SELECT actor, user_label FROM audit_log WHERE table_name = 'customers' AND record_id = $1 ORDER BY id DESC LIMIT 1",
    [created.body.id]
  );
  assert.equal(rows[0].actor, 'web');
  // And the trail says which person it was.
  assert.equal(rows[0].user_label, 'owner@shop.test');
});

test("the receptionist's own calls need its secret, and carry the person's permissions", async () => {
  const anonymous = browser();
  const guessed = await anonymous.get('/api/products', { headers: { 'x-docdesk-internal': 'guess', 'x-docdesk-user': '1' } });
  assert.equal(guessed.status, 401);

  const asStaff = { 'x-docdesk-internal': internalToken, 'x-docdesk-user': String(staff.jar.id), 'x-docdesk-actor': 'receptionist' };
  assert.equal((await anonymous.get('/api/products', { headers: asStaff })).status, 200);
  // Asking the receptionist is not a way around not being allowed.
  assert.equal((await anonymous.put('/api/settings', { business_name: 'Via the AI' }, { headers: asStaff })).status, 403);
  assert.equal((await anonymous.post('/api/db/query', { sql: 'SELECT 1' }, { headers: asStaff })).status, 403);

  const created = await anonymous.post('/api/customers', { name: 'Booked By AI' }, { headers: asStaff });
  assert.equal(created.status, 201);
  const { rows } = await db.query("SELECT actor, user_label FROM audit_log WHERE table_name = 'customers' AND record_id = $1", [created.body.id]);
  assert.equal(rows[0].actor, 'receptionist');
  assert.equal(rows[0].user_label, 'staff@shop.test');

  // With the secret but nobody to act for, it acts for nobody.
  assert.equal((await anonymous.get('/api/products', { headers: { 'x-docdesk-internal': internalToken } })).status, 401);
});

// --- sessions ending ---------------------------------------------------------

test('turning someone away signs them out at once', async () => {
  assert.equal((await staff.get('/api/products')).status, 200);
  await owner.put(`/api/team/${staff.jar.id}`, { status: 'disabled' });

  assert.equal((await staff.get('/api/products')).status, 401);
  const again = await staff.signIn('uid-staff', 'staff@shop.test');
  assert.equal(again.status, 403, 'and they cannot simply sign in again');
  assert.equal(again.body.code, 'disabled');

  await owner.put(`/api/team/${staff.jar.id}`, { status: 'active' });
  assert.equal((await staff.signIn('uid-staff', 'staff@shop.test')).status, 201);
});

test('signing out ends the session on the server, not just in the browser', async () => {
  const visitor = browser();
  await visitor.signIn('uid-staff', 'staff@shop.test');
  const kept = visitor.jar.cookie;
  assert.equal((await visitor.get('/api/products')).status, 200);

  assert.equal((await visitor.del('/api/auth/session')).status, 200);
  // Somebody who had copied the cookie beforehand gets nowhere with it.
  visitor.jar.cookie = kept;
  assert.equal((await visitor.get('/api/products')).status, 401);
});

test('a session left unused long enough is over', async () => {
  const visitor = browser();
  await visitor.signIn('uid-staff', 'staff@shop.test');
  const hash = crypto.createHash('sha256').update(visitor.jar.cookie.split('=')[1]).digest('hex');

  await db.query("UPDATE sessions SET last_used_at = now() - interval '8 days' WHERE token_hash = $1", [hash]);
  require('../lib/auth/accounts').forgetUser(staff.jar.id);
  assert.equal((await visitor.get('/api/products')).status, 401);

  const { rows } = await db.query('SELECT 1 FROM sessions WHERE token_hash = $1', [hash]);
  assert.equal(rows.length, 0, 'and it is cleaned up, not just ignored');
});

// --- the things in front of the database ---------------------------------------

test('too many sign-in attempts from one place are slowed down', async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    statuses.push((await browser().post('/api/auth/session', { idToken: 'nonsense' })).status);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.deepEqual(statuses.slice(10), [429, 429]);

  const limited = await browser().post('/api/auth/session', { idToken: 'nonsense' });
  assert.equal(limited.body.code, 'rate_limited');
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
});

test('a report is computed once and then remembered - until something is written', async () => {
  const url = '/api/reports/summary?days=30&tz=UTC';
  assert.equal((await owner.get(url)).headers.get('x-cache'), 'MISS');
  const second = await owner.get(url);
  assert.equal(second.headers.get('x-cache'), 'HIT');

  // Any committed change makes the remembered answer out of date.
  await owner.post('/api/customers', { name: 'Cache Buster' });
  assert.equal((await owner.get(url)).headers.get('x-cache'), 'MISS');
  assert.equal((await owner.get(url)).headers.get('x-cache'), 'HIT');

  // Signing in or out is not a change to the business's data.
  const visitor = browser();
  await visitor.signIn('uid-staff', 'staff@shop.test');
  await visitor.del('/api/auth/session');
  assert.equal((await owner.get(url)).headers.get('x-cache'), 'HIT');
});

test('an unchanged answer is not sent twice', async () => {
  const first = await owner.get('/api/customers');
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal(first.headers.get('cache-control'), 'private, no-cache');
  // Asked the way a browser's cache asks. (fetch cannot be used for this: given
  // an If-None-Match by hand it adds "Cache-Control: no-cache", which is a
  // request for the full answer.)
  const again = await new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port: process.env.PORT, path: '/api/customers', headers: { Cookie: owner.jar.cookie, 'If-None-Match': etag } },
      (response) => {
        let length = 0;
        response.on('data', (chunk) => { length += chunk.length; });
        response.on('end', () => resolve({ status: response.statusCode, length }));
      }
    );
    request.on('error', reject);
    request.end();
  });
  assert.equal(again.status, 304);
  assert.equal(again.length, 0);
});

test('every answer carries the headers that stop it being misused', async () => {
  const result = await owner.get('/api/customers');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.headers.get('x-frame-options'), 'DENY');
  assert.match(result.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(result.headers.get('x-powered-by'), null);
});

test('an upload is checked against its own bytes', async () => {
  const send = (name, type, bytes) => {
    const form = new FormData();
    form.append('files', new Blob([bytes], { type }), name);
    return owner.post('/api/files', null, { form });
  };

  const fake = await send('holiday.png', 'image/png', Buffer.from('<!doctype html><script>alert(document.cookie)</script>'));
  assert.equal(fake.status, 400);
  assert.match(fake.body.error, /not what its name says/);

  const program = await send('setup.exe', 'application/x-msdownload', Buffer.from([0x4d, 0x5a, 0x90, 0]));
  assert.equal(program.status, 400);

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const real = await send('logo.png', 'image/png', png);
  assert.equal(real.status, 201);

  // The refused ones left nothing behind.
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, 1);

  const served = await owner.get(`/api/files/${real.body.files[0].id}/content`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('content-security-policy'), /default-src 'none'/);
});

test('quoting a function name does not get it past the console', () => {
  for (const sql of [
    "SELECT set_config('docdesk.actor', 'web', true)",
    'SELECT "set_config"(\'docdesk.actor\', \'web\', true)',
    'SELECT pg_catalog."pg_read_file"(\'/etc/passwd\')',
    'SELECT "PG_READ_FILE"(\'x\')',
    'SELECT U&"\\0073et_config"(\'a\', \'b\', true)',
    'SELECT pg_sleep(60)',
  ]) {
    assert.throws(() => sqlRunner.classify(sql), /not available in the SQL console/, sql);
  }
  // A column that merely has an awkward name is still fine.
  assert.equal(sqlRunner.classify('SELECT name AS "set config" FROM customers').kind, 'read');
  assert.equal(sqlRunner.classify("SELECT 'set_config' AS word").kind, 'read');
});

test('the console still cannot be made to change anything in read mode', async () => {
  const result = await owner.post('/api/db/query', { sql: "DELETE FROM customers" });
  assert.equal(result.status, 403);
  const stacked = await owner.post('/api/db/query', { sql: 'SELECT 1; DELETE FROM customers' });
  assert.equal(stacked.status, 400);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM customers');
  assert.ok(rows[0].n > 0);
});

test('search text is data, wherever it is put', async () => {
  const before = (await db.query('SELECT count(*)::int AS n FROM customers')).rows[0].n;
  const attack = "'; DROP TABLE customers; --";
  for (const url of [
    `/api/customers?search=${encodeURIComponent(attack)}`,
    `/api/search?q=${encodeURIComponent(attack)}`,
    `/api/customers?sort=${encodeURIComponent('name; DROP TABLE customers')}`,
    `/api/customers?dir=${encodeURIComponent('asc; DROP TABLE customers')}`,
    `/api/export/customers?format=json&search=${encodeURIComponent("' OR '1'='1")}`,
    `/api/export/${encodeURIComponent('customers; DROP TABLE customers')}`,
  ]) {
    const result = await owner.get(url);
    assert.ok([200, 400].includes(result.status), `${url} -> ${result.status}`);
  }
  // "' OR '1'='1" matched nobody: it was searched for, not executed.
  const injected = await owner.get(`/api/export/customers?format=json&search=${encodeURIComponent("' OR '1'='1")}`);
  assert.deepEqual(JSON.parse(injected.text).rows, []);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM customers')).rows[0].n, before);
});

test('a backup holds the business, not the list of who may sign in', async () => {
  const made = await owner.post('/api/db/backups', {});
  assert.equal(made.status, 201);
  const zlib = require('node:zlib');
  const document = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(process.env.BACKUP_DIR, made.body.name))).toString('utf8'));
  assert.ok(document.tables.customers);
  assert.equal(document.tables.users, undefined);
  assert.equal(document.tables.sessions, undefined);
});

test('an unexpected fault says nothing about the inside of the server', async () => {
  const errorHandler = require('../middleware/errorHandler');
  const sent = {};
  const res = { status(code) { sent.status = code; return this; }, json(body) { sent.body = body; } };
  const original = console.error;
  console.error = () => {};
  try {
    errorHandler(new Error('ENOENT: no such file, open E:\\DocDesk\\server\\.env'), { method: 'GET', originalUrl: '/api/x?search=secret' }, res, () => {});
  } finally {
    console.error = original;
  }
  assert.equal(sent.status, 500);
  assert.doesNotMatch(sent.body.error, /ENOENT|\.env|DocDesk\\server/);
  assert.match(sent.body.error, /reference [0-9a-f]{8}/);
});

// --- the way back in -----------------------------------------------------------

test('AUTH_REQUIRED=off opens this computer, and only this computer', async () => {
  const net = require('../lib/net');
  process.env.AUTH_REQUIRED = 'off';
  try {
    assert.equal(net.authRequired(), false);
    const anonymous = browser();
    assert.equal((await anonymous.get('/api/products')).status, 200);
    assert.equal((await anonymous.get('/api/auth/session')).body.signInRequired, false);
    // Still not from another website.
    assert.equal((await anonymous.post('/api/customers', { name: 'x' }, { headers: { Origin: 'https://evil.example' } })).status, 403);

    // The moment this is a deployment, the switch does nothing.
    process.env.NODE_ENV = 'production';
    assert.equal(net.authRequired(), true);
    delete process.env.NODE_ENV;
    process.env.HOST = '0.0.0.0';
    assert.equal(net.authRequired(), true);
  } finally {
    delete process.env.AUTH_REQUIRED;
    delete process.env.NODE_ENV;
    delete process.env.HOST;
  }
  assert.equal((await browser().get('/api/products')).status, 401);
});

test('OWNER_EMAIL names the one account that is made owner without being asked', async () => {
  process.env.OWNER_EMAIL = 'boss@shop.test';
  try {
    // Somebody else typing that address into a password sign-up proves nothing.
    const impostor = browser();
    const unverified = await impostor.post('/api/auth/session', {
      idToken: idToken('uid-impostor', 'boss@shop.test', { email_verified: false }),
    });
    assert.equal(unverified.body.user.status, 'pending');

    const boss = browser();
    const verified = await boss.signIn('uid-boss', 'boss@shop.test');
    assert.equal(verified.body.user.role, 'owner');
    assert.equal(verified.body.user.status, 'active');
  } finally {
    delete process.env.OWNER_EMAIL;
  }
});
