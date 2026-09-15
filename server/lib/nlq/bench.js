/**
 * Measures how well a configured provider actually handles "manipulate this
 * table" instructions.
 *
 * Run: npm run bench:ai            (uses whatever LLM_PROVIDER/keys are set)
 *      LLM_PROVIDER=groq npm run bench:ai
 *
 * Every case states the operation a correct answer must produce, so this scores
 * accuracy rather than just "did it reply".
 */
const db = require('../../db');
const { interpret } = require('./interpret');
const { status } = require('../llm');

const CASES = [
  {
    request: 'sort by price, cheapest first',
    expect: { type: 'sort', column: 'sale_price', direction: 'asc' },
  },
  {
    request: 'show the most expensive products first',
    expect: { type: 'sort', column: 'sale_price', direction: 'desc' },
  },
  {
    request: 'add a column for expiry date',
    expect: { type: 'add_column', columnType: 'date' },
  },
  {
    request: 'add a text column called shelf location',
    expect: { type: 'add_column', name: 'shelf_location', columnType: 'text' },
  },
  {
    request: 'only show me hygiene products',
    expect: { type: 'filter' },
  },
  {
    request: 'which products cost more than 500',
    expect: { type: 'filter' },
  },
  {
    request: 'how many products are there in each category',
    expect: { type: 'summarize', groupBy: 'category' },
  },
  {
    request: 'what is the average sale price',
    expect: { type: 'summarize' },
  },
  {
    request: 'rename the unit column to measured in',
    expect: { type: 'rename_column', from: 'unit', to: 'measured_in' },
  },
  {
    request: 'set the category to Misc for anything with no category',
    expect: { type: 'set_values' },
  },
  // Should be refused rather than guessed at - a wrong answer here is worse
  // than no answer.
  {
    request: 'make it better',
    expectFailure: true,
  },
  {
    request: 'delete everything and drop the database',
    expectFailure: true,
  },
];

function matches(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) return false;
  }
  return true;
}

async function run() {
  const info = status();
  if (!info.configured) {
    console.log('No AI provider configured. Set a key in server/.env first.');
    console.log(`Expected one of: ${info.providers.map((p) => p.keyVar).join(', ')}`);
    return;
  }

  console.log(`Provider : ${info.label} (${info.provider})`);
  console.log(`Model    : ${info.model}`);
  console.log(`Cases    : ${CASES.length}\n`);

  const latencies = [];
  let passed = 0;

  for (const testCase of CASES) {
    let line = `  ${testCase.request.padEnd(52)}`;
    try {
      const result = await interpret('products', testCase.request);
      latencies.push(result.latencyMs);

      if (testCase.expectFailure) {
        console.log(`${line}FAIL  should have been refused, got ${result.operation.type}`);
        continue;
      }
      if (matches(result.operation, testCase.expect)) {
        passed++;
        console.log(`${line}pass  ${result.latencyMs}ms  ${result.operation.type}`);
      } else {
        console.log(
          `${line}FAIL  got ${JSON.stringify(result.operation)} want ${JSON.stringify(testCase.expect)}`
        );
      }
    } catch (err) {
      if (testCase.expectFailure) {
        passed++;
        console.log(`${line}pass  refused: ${err.message.slice(0, 44)}`);
      } else {
        console.log(`${line}FAIL  ${err.message.slice(0, 60)}`);
      }
    }
  }

  latencies.sort((a, b) => a - b);
  const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;
  const slowest = latencies.length ? latencies.at(-1) : 0;

  console.log(`\n  ${passed}/${CASES.length} correct`);
  console.log(`  median ${median}ms · slowest ${slowest}ms`);
}

if (require.main === module) {
  run()
    .then(async () => {
      await db.close();
    })
    .catch(async (err) => {
      console.error('bench failed:', err.message);
      await db.close();
      process.exit(1);
    });
}

module.exports = { CASES, run };
