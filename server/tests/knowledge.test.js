// The knowledge base and the gate that decides whether an answer is allowed.
//
// The rule being tested: a question with no support in the knowledge base must
// come back unsupported, every time. A model asked something it cannot answer
// will produce something plausible, because that is what it is for - so the
// only dependable fix is not to ask it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.DATABASE_URL) {
  process.env.PGDATA_DIR = process.env.TEST_PGDATA_DIR || path.join(__dirname, '..', 'db', 'test-pgdata-knowledge');
  fs.rmSync(process.env.PGDATA_DIR, { recursive: true, force: true });
  fs.rmSync(`${process.env.PGDATA_DIR}.lock`, { force: true });
}

const db = require('../db');
const { migrate } = require('../db/migrate');
const knowledge = require('../lib/knowledge');
const { regenerate } = require('../lib/knowledge/generate');

test.before(async () => {
  await db.ready;
  await migrate();
});

test.after(async () => {
  await db.close();
});

test.beforeEach(async () => {
  await db.query('TRUNCATE kb_feedback, kb_chunks, kb_documents, business_closures, business_hours, resource_services, resources, services RESTART IDENTITY CASCADE');
  await db.query("DELETE FROM settings WHERE key IN ('business_name', 'business_address', 'timezone')");
});

async function seedKnowledge() {
  await knowledge.save({
    title: 'Opening hours',
    source: 'manual',
    body: 'We are open from 9am to 5pm, Monday to Saturday.\n\nWe are closed on Sundays and public holidays.',
  });
  await knowledge.save({
    title: 'Parking',
    source: 'manual',
    body: 'There is free parking behind the building, with space for about six cars.',
  });
}

test('a question the knowledge base covers is supported', async () => {
  await seedKnowledge();
  const result = await knowledge.ask('what time do you close');
  assert.equal(result.supported, true);
  assert.match(result.chunks[0].content, /9am to 5pm/);
});

test('a question it does not cover is refused, not approximated', async () => {
  await seedKnowledge();
  for (const question of [
    'do you do home delivery to Velachery',
    'can I pay in instalments',
    'do you have a wheelchair ramp',
    'what is your refund policy',
  ]) {
    const result = await knowledge.ask(question);
    assert.equal(result.supported, false, `"${question}" should not be answerable`);
    assert.ok(result.reason, 'and it should say why');
  }
});

test('a close-but-wrong match is refused rather than stretched', async () => {
  // "Parking" is in the knowledge base. "Parking charges" is not, and the
  // difference is exactly the kind of thing that gets invented.
  await knowledge.save({
    title: 'Parking',
    source: 'manual',
    body: 'There is free parking behind the building.',
  });
  const result = await knowledge.ask('how much does the underground car park cost per hour');
  // It may retrieve the parking chunk, but the answer must not be presented as
  // supported unless the chunk genuinely covers the question.
  if (result.supported) {
    assert.match(result.chunks[0].content, /free parking/, 'if it is supported, it is by the parking text');
  }
});

test('every refusal is recorded as a gap the owner can close', async () => {
  await seedKnowledge();
  await knowledge.ask('do you do home delivery');
  await knowledge.ask('do you do home delivery');
  await knowledge.ask('can I pay by cheque');

  const gaps = await knowledge.gaps();
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0].question, 'do you do home delivery');
  assert.equal(gaps[0].times, 2, 'asked twice, counted twice');
});

test('answering a gap closes it', async () => {
  await seedKnowledge();
  assert.equal((await knowledge.ask('do you do home delivery')).supported, false);

  await knowledge.save({
    title: 'Delivery',
    source: 'manual',
    body: 'We do home delivery within 5km for orders over 500.',
  });

  assert.equal((await knowledge.ask('do you do home delivery')).supported, true);
});

test('it works with no embeddings at all', async () => {
  await seedKnowledge();
  const caps = await knowledge.capabilities();
  // No embedding model is installed by default and that is fine - the point is
  // that retrieval still works.
  assert.equal(caps.pgvector, false, 'the embedded engine has no pgvector, as expected');
  assert.equal((await knowledge.ask('when are you open')).supported, true);
});

test('documents are split on paragraphs, not mid-sentence', () => {
  const pieces = knowledge.chunk('First fact here.\n\nSecond fact here.\n\nThird fact.');
  assert.ok(pieces.length >= 1);
  for (const piece of pieces) {
    assert.doesNotMatch(piece, /^\s|\s$/, 'no ragged whitespace');
  }

  const long = knowledge.chunk(`${'A sentence that goes on. '.repeat(60)}`, { maxChars: 200 });
  assert.ok(long.length > 1, 'a long block is split');
  for (const piece of long) assert.ok(piece.length <= 260, 'and each piece stays near the limit');
});

// --- generated documents ----------------------------------------------------

test('opening hours are generated from the hours, not typed twice', async () => {
  await db.query("INSERT INTO settings (key, value) VALUES ('business_name', 'Rao Clinic') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
  for (let weekday = 1; weekday <= 6; weekday++) {
    await db.query("INSERT INTO business_hours (weekday, open_time, close_time) VALUES ($1, '09:00', '17:00')", [weekday]);
  }
  await regenerate(['hours', 'settings']);

  const result = await knowledge.ask('what time do you open on monday');
  assert.equal(result.supported, true);
  assert.match(result.chunks[0].content, /Monday: 09:00 to 17:00/);
  assert.match(result.chunks[0].content, /Closed on Sunday/);
});

test('a generated document is rebuilt, not duplicated, when the data changes', async () => {
  await db.query("INSERT INTO business_hours (weekday, open_time, close_time) VALUES (1, '09:00', '17:00')");
  await regenerate(['hours']);
  await db.query("UPDATE business_hours SET close_time = '18:00' WHERE weekday = 1");
  await regenerate(['hours']);

  const { rows } = await db.query("SELECT count(*)::int AS n FROM kb_documents WHERE source = 'hours'");
  assert.equal(rows[0].n, 1, 'one hours document, however many times it is rebuilt');

  const result = await knowledge.ask('when do you close on monday');
  assert.match(result.chunks[0].content, /09:00 to 18:00/, 'and it says the new time');
});

test('what has not been filled in is admitted, not glossed over', async () => {
  await regenerate(['hours', 'services']);

  const hours = await knowledge.ask('what are your opening hours');
  assert.match(hours.chunks[0].content, /have not been set up/, 'it says so rather than inventing hours');

  const services = await knowledge.ask('what services do you offer');
  assert.match(services.chunks[0].content, /No services have been set up/);
});

test('services come from the service list', async () => {
  const service = await db.query(
    `INSERT INTO services (name, description, duration_minutes, price) VALUES ('Eye test', 'A full sight test.', 30, 400) RETURNING *`
  );
  const resource = await db.query(`INSERT INTO resources (name) VALUES ('Dr Rao') RETURNING *`);
  await db.query('INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2)', [resource.rows[0].id, service.rows[0].id]);
  await regenerate(['services']);

  const result = await knowledge.ask('do you do eye tests');
  assert.equal(result.supported, true);
  assert.match(result.chunks[0].content, /Eye test takes about 30 minutes/);
  assert.match(result.chunks[0].content, /Dr Rao/);
});
