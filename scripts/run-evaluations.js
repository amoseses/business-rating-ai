/**
 * CLI script to run the evaluation test suite locally.
 * Usage: node scripts/run-evaluations.js [--plan data|plus] [--types saas,hardware] [--no-persist]
 */
const path = require('path');

// Set the working directory to project root
process.chdir(path.join(__dirname, '..'));

// Load environment variables from .env.local if present
try {
  const envPath = path.join(__dirname, '..', '.env.local');
  const envContent = require('fs').readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
} catch (e) {
  // No .env.local file, that's fine
}

const { runEvaluationSuite, TEST_PITCHES } = require('../lib/evaluations');

// Parse CLI arguments
const args = process.argv.slice(2);
const plan = args.includes('--plan') ? args[args.indexOf('--plan') + 1] : 'data';
const noPersist = args.includes('--no-persist');

const pitchTypesArg = args.includes('--types') ? args[args.indexOf('--types') + 1] : null;
const pitchTypes = pitchTypesArg ? pitchTypesArg.split(',') : null;

const hasHelp = args.includes('--help') || args.includes('-h');

if (hasHelp) {
  console.log(`
Usage: node scripts/run-evaluations.js [options]

Options:
  --plan <data|plus>       Plan to test with (default: data)
  --types <type1,type2>    Comma-separated pitch types to test (default: all)
  --no-persist             Don't save results to Supabase
  --help, -h               Show this help

Available pitch types:
  ${Object.keys(TEST_PITCHES).join(', ')}

Example:
  node scripts/run-evaluations.js --plan plus
  node scripts/run-evaluations.js --types saas,marketplace --no-persist
`);
  process.exit(0);
}

console.log('='.repeat(60));
console.log('Business Rating AI - Evaluation Suite');
console.log('='.repeat(60));
console.log(`Plan: ${plan}`);
console.log(`Pitch types: ${pitchTypes ? pitchTypes.join(', ') : 'all'}`);
console.log(`Persist: ${!noPersist}`);
console.log('-'.repeat(60));

const startTime = Date.now();

runEvaluationSuite({ plan, persist: !noPersist, pitchTypes })
  .then(({ results, summary }) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n');
    console.log('='.repeat(60));
    console.log('RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total:    ${summary.total}`);
    console.log(`Passed:   ${summary.passed}`);
    console.log(`Failed:   ${summary.failed}`);
    console.log(`Pass rate: ${summary.passRate}%`);
    console.log(`Avg score: ${summary.averageScore}/100`);
    console.log(`Avg time:  ${summary.averageExecutionTimeMs}ms`);
    console.log(`Elapsed:   ${elapsed}s`);
    console.log('-'.repeat(60));

    // Detailed results
    console.log('\nDETAILED RESULTS:');
    console.log('-'.repeat(60));

    for (const result of results) {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      const padding = result.error ? ` [ERROR: ${result.error}]` : '';
      console.log(`${status} | ${result.testName.padEnd(20)} | Score: ${result.actualScore}/100 (expected ${result.expectedScoreMin}-${result.expectedScoreMax}) | ${result.executionTimeMs}ms${padding}`);
    }

    console.log('-'.repeat(60));
    console.log(`\nEvaluation complete. ${summary.passed}/${summary.total} tests passed.`);
    
    process.exit(summary.failed > 0 ? 1 : 0);
  })
  .catch(err => {
    console.error('Evaluation suite failed:', err);
    process.exit(1);
  });