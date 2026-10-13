// The pieces that sit in front of the database and need no database to check:
// the rate limiter, the cache, the file-type check and the small guards.
//
// Each takes its clock as an argument, so "a minute later" is a number added
// to a variable rather than a test that sleeps for a minute.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createLimiter } = require('../lib/rateLimit');
const { createCache } = require('../lib/cache');
const { SIGNATURES, looksLikeText, contentDisposition, cleanOriginalName } = require('../lib/storage');
const { maskContact, pathOnly } = require('../lib/redact');
const { checked } = require('../lib/receptionist/internalApi');

// --- rate limiting -----------------------------------------------------------

test('a bucket allows its burst, then refuses', () => {
  let now = 0;
  const limiter = createLimiter({ name: 't', capacity: 5, perMinute: 60, now: () => now });
  for (let i = 0; i < 5; i++) assert.equal(limiter.take('a').allowed, true, `request ${i + 1}`);
  const refused = limiter.take('a');
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  // One token a second: the sixth request has to wait for exactly one.
  assert.equal(refused.retryAfterMs, 1000);
});

test('tokens come back at the refill rate, and never beyond capacity', () => {
  let now = 0;
  const limiter = createLimiter({ name: 't', capacity: 5, perMinute: 60, now: () => now });
  for (let i = 0; i < 5; i++) limiter.take('a');

  now += 2000;
  assert.equal(limiter.take('a').allowed, true);
  assert.equal(limiter.take('a').allowed, true);
  assert.equal(limiter.take('a').allowed, false, 'two seconds buys two requests, not three');

  // A long quiet spell refills the bucket but does not bank extra.
  now += 3_600_000;
  for (let i = 0; i < 5; i++) assert.equal(limiter.take('a').allowed, true);
  assert.equal(limiter.take('a').allowed, false);
});

test('one caller running out does not slow another', () => {
  let now = 0;
  const limiter = createLimiter({ name: 't', capacity: 2, perMinute: 60, now: () => now });
  limiter.take('noisy');
  limiter.take('noisy');
  assert.equal(limiter.take('noisy').allowed, false);
  assert.equal(limiter.take('quiet').allowed, true);
});

test('the limits the API actually uses are sane', () => {
  const { limiters } = require('../middleware/rateLimit');
  const sizes = Object.fromEntries(Object.values(limiters).map((l) => [l.name, l.snapshot()]));
  // Signing in is the tightest, and the expensive work is tighter than ordinary use.
  assert.ok(sizes.signIn.capacity < sizes.heavy.capacity);
  assert.ok(sizes.heavy.capacity < sizes.changes.capacity);
  assert.ok(sizes.changes.capacity < sizes.person.capacity);
  assert.ok(sizes.person.capacity <= sizes.address.capacity);
});

// --- the cache ---------------------------------------------------------------

test('a cached value answers until its time is up', () => {
  let now = 0;
  const cache = createCache({ ttlMs: 1000, now: () => now });
  cache.set('k', 'v');
  now = 999;
  assert.equal(cache.get('k'), 'v');
  now = 1000;
  assert.equal(cache.get('k'), undefined);
});

test('a value stored under one data version is a miss under the next', () => {
  const cache = createCache({ ttlMs: 60_000 });
  cache.set('report', { revenue: 100 }, { version: 7 });
  assert.deepEqual(cache.get('report', { version: 7 }), { revenue: 100 });
  // Something was written: nobody had to find and delete this entry.
  assert.equal(cache.get('report', { version: 8 }), undefined);
});

test('when it is full, the entry used longest ago goes first', () => {
  const cache = createCache({ ttlMs: 60_000, max: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a'); // a is now the more recently used
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.snapshot().evictions, 1);
});

test('ten callers missing at once cause one load, not ten', async () => {
  const cache = createCache({ ttlMs: 60_000 });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return 'answer';
  };
  const results = await Promise.all(Array.from({ length: 10 }, () => cache.wrap('k', loader)));
  assert.deepEqual([...new Set(results)], ['answer']);
  assert.equal(loads, 1);
});

test('a failed load is not remembered', async () => {
  const cache = createCache({ ttlMs: 60_000 });
  await assert.rejects(cache.wrap('k', async () => { throw new Error('down'); }));
  assert.equal(await cache.wrap('k', async () => 'recovered'), 'recovered');
});

// --- uploads -----------------------------------------------------------------

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PDF = Buffer.from('%PDF-1.7\n%\u00e2\u00e3\n1 0 obj');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0]);
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

test('a file is accepted for what its bytes are, not what it is called', () => {
  assert.equal(SIGNATURES['image/png'](PNG), true);
  assert.equal(SIGNATURES['image/jpeg'](JPEG), true);
  assert.equal(SIGNATURES['application/pdf'](PDF), true);
  assert.equal(SIGNATURES['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'](ZIP), true);

  // A web page labelled as a picture, a program labelled as a PDF.
  assert.equal(SIGNATURES['image/png'](HTML), false);
  assert.equal(SIGNATURES['image/jpeg'](PNG), false);
  assert.equal(SIGNATURES['application/pdf'](EXE), false);
  assert.equal(SIGNATURES['application/msword'](ZIP), false);
});

test('text is recognised by what it is not', () => {
  assert.equal(looksLikeText(Buffer.from('name,price\nPen,10\n')), true);
  assert.equal(looksLikeText(Buffer.from('{"a": 1}')), true);
  assert.equal(looksLikeText(EXE), false);
  assert.equal(looksLikeText(ZIP), false);
  assert.equal(looksLikeText(PNG), false, 'binary formats carry NUL bytes early');
});

test('every type on the allow-list has a check', () => {
  const { ALLOWED } = require('../lib/storage');
  for (const type of Object.keys(ALLOWED)) {
    assert.equal(typeof SIGNATURES[type], 'function', `${type} is allowed but never verified`);
  }
});

test('a filename cannot break out of, or into, a header', () => {
  const header = contentDisposition('attachment', 'in"voice\r\nSet-Cookie: x=1.pdf');
  assert.doesNotMatch(header, /[\r\n]/);
  assert.match(header, /^attachment; filename="[^"]*"; filename\*=UTF-8''/);

  // Names in other alphabets survive, in the encoded form.
  const hindi = contentDisposition('inline', 'रसीद.pdf');
  assert.match(hindi, /filename\*=UTF-8''%E0%A4%B0/);
  assert.doesNotMatch(hindi.split('filename*=')[0], /[^\x20-\x7e]/);
});

test('the folder a file came from is not part of its name', () => {
  assert.equal(cleanOriginalName('C:\\Users\\me\\Desktop\\bill.pdf'), 'bill.pdf');
  assert.equal(cleanOriginalName('../../etc/passwd'), 'passwd');
  assert.equal(cleanOriginalName(''), 'file');
});

// --- small guards ------------------------------------------------------------

test('contact details are masked before they reach the log', () => {
  assert.equal(maskContact('priya@example.com'), 'p***@example.com');
  assert.equal(maskContact('+91 98765 43210'), '*** 3210');
  assert.equal(maskContact(''), '');
  assert.equal(pathOnly('/api/customers?search=Priya+9876543210'), '/api/customers');
});

test('the receptionist can only be sent to plain paths', () => {
  assert.equal(checked('/products/12/stock'), '/products/12/stock');
  assert.equal(checked('/purchase-orders'), '/purchase-orders');
  for (const path of ['/products/../db/restore', '/products/./1', '//evil.example/x', '/products/1?x=1', '/a b', 'products', '/products/1#x', '/products\\..\\db']) {
    assert.throws(() => checked(path), /not somewhere/, path);
  }
});
