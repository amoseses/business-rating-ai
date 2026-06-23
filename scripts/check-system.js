/**
 * System health check script.
 * Verifies all modules load correctly and environment is configured.
 * Usage: node scripts/check-system.js
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));

let exitCode = 0;
const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

function report(name, passed, detail = '') {
  const icon = passed ? '✓' : '✗';
  console.log(`  ${icon} ${name}${detail ? ': ' + detail : ''}`);
  if (!passed) exitCode = 1;
}

console.log('Business Rating AI - System Check');
console.log('='.repeat(50));

// Module loading checks
check('Module loading', () => {
  console.log('\n[Module Loading]');

  try {
    const supabase = require('../lib/supabase');
    report('lib/supabase.js', true, supabase.isSupabaseConfigured() ? 'Supabase configured' : 'Supabase not configured (null client)');
  } catch (e) {
    report('lib/supabase.js', false, e.message);
  }

  try {
    const analytics = require('../lib/analytics');
    report('lib/analytics.js', true, `exports: ${Object.keys(analytics).join(', ')}`);
  } catch (e) {
    report('lib/analytics.js', false, e.message);
  }

  try {
    const errorLogger = require('../lib/error-logger');
    report('lib/error-logger.js', true, `exports: ${Object.keys(errorLogger).join(', ')}`);
  } catch (e) {
    report('lib/error-logger.js', false, e.message);
  }

  try {
    const perf = require('../lib/performance');
    report('lib/performance.js', true, `exports: ${Object.keys(perf).join(', ')}`);
  } catch (e) {
    report('lib/performance.js', false, e.message);
  }

  try {
    const scoring = require('../lib/scoring-consistency');
    report('lib/scoring-consistency.js', true, `exports: ${Object.keys(scoring).join(', ')}`);
  } catch (e) {
    report('lib/scoring-consistency.js', false, e.message);
  }

  try {
    const cache = require('../lib/cache');
    report('lib/cache.js', true, `exports: ${Object.keys(cache).join(', ')}`);
  } catch (e) {
    report('lib/cache.js', false, e.message);
  }

  try {
    const backup = require('../lib/backup');
    report('lib/backup.js', true, `exports: ${Object.keys(backup).join(', ')}`);
  } catch (e) {
    report('lib/backup.js', false, e.message);
  }

  try {
    const evals = require('../lib/evaluations');
    report('lib/evaluations.js', true, `exports: ${Object.keys(evals).join(', ')}, ${Object.keys(evals.TEST_PITCHES).length} test pitches`);
  } catch (e) {
    report('lib/evaluations.js', false, e.message);
  }

  try {
    const analyze = require('../lib/analyze');
    report('lib/analyze.js', true, `exports: ${Object.keys(analyze).join(', ')}`);
  } catch (e) {
    report('lib/analyze.js', false, e.message);
  }
});

// Scoring consistency check
check('Scoring consistency', () => {
  console.log('\n[Scoring Consistency]');
  const { normalizeScore, generateLabel, hashPitch, scoreSimilarity } = require('../lib/scoring-consistency');

  // Test 1: Basic normalization
  const result1 = normalizeScore({
    rawScore: 75,
    sections: { Problem: 80, Solution: 70, Market: 75, Traction: 60, 'Business model': 85, Moat: 70, Ask: 80 },
    wordCount: 200,
    plan: 'data',
    redFlags: [],
    missingProof: []
  });
  report('normalizeScore (balanced)', result1.score >= 70 && result1.score <= 85, `score=${result1.score}, passes=${result1.passes.length}`);

  // Test 2: Short pitch penalty
  const result2 = normalizeScore({
    rawScore: 50,
    sections: { Problem: 50, Solution: 50, Market: 50, Traction: 50, 'Business model': 50, Moat: 50, Ask: 50 },
    wordCount: 30,
    plan: 'data',
    redFlags: [],
    missingProof: []
  });
  report('normalizeScore (short pitch)', result2.score < 50, `score=${result2.score} (was 50, short penalty applied)`);

  // Test 3: Red flag penalty
  const result3 = normalizeScore({
    rawScore: 80,
    sections: { Problem: 80, Solution: 80, Market: 80, Traction: 80, 'Business model': 80, Moat: 80, Ask: 80 },
    wordCount: 200,
    plan: 'data',
    redFlags: ['No clear revenue model', 'Small market size'],
    missingProof: []
  });
  report('normalizeScore (red flags)', result3.score < 80, `score=${result3.score} (was 80, red flag penalty applied)`);

  // Test 4: Label generation
  report('generateLabel (90)', generateLabel(90) === 'Exceptional — investor-ready', generateLabel(90));
  report('generateLabel (80)', generateLabel(80) === 'Investor-ready', generateLabel(80));
  report('generateLabel (30)', generateLabel(30) === 'Not ready — needs major revision', generateLabel(30));

  // Test 5: Hash
  const hash1 = hashPitch('Test pitch');
  const hash2 = hashPitch('Test pitch');
  const hash3 = hashPitch('Different pitch');
  report('hashPitch (deterministic)', hash1 === hash2, hash1);
  report('hashPitch (different inputs differ)', hash1 !== hash3, 'OK');

  // Test 6: Similarity
  const sim1 = scoreSimilarity({ score: 75 }, { score: 80 });
  const sim2 = scoreSimilarity({ score: 10 }, { score: 90 });
  report('scoreSimilarity (close)', sim1 > 0.9, `similarity=${sim1.toFixed(3)}`);
  report('scoreSimilarity (far apart)', sim2 < 0.3, `similarity=${sim2.toFixed(3)}`);
});

// Analysis check
check('Analysis engine', () => {
  console.log('\n[Analysis Engine]');
  const { analyzePitch, analyzeBasic } = require('../lib/analyze');

  // Test basic analysis
  const result = analyzeBasic('We are solving a big problem with our platform. Our solution automates everything. We have revenue and users growing fast. Our market is huge. We charge a subscription fee.', 'data');
  report('analyzeBasic returns score', typeof result.score === 'number', `score=${result.score}`);
  report('analyzeBasic returns sections', typeof result.sections === 'object', `sections: ${Object.keys(result.sections).join(', ')}`);
  report('analyzeBasic returns recommendations', Array.isArray(result.recommendations), `${result.recommendations.length} recommendations`);

  // Test with empty pitch
  const emptyResult = analyzePitch('', 'data');
  report('analyzePitch empty input', emptyResult.error === 'Pitch text is required.', emptyResult.error);

  // Test with null
  const nullResult = analyzePitch(null, 'data');
  report('analyzePitch null input', nullResult.error === 'Pitch text is required.', nullResult.error);
});

// Environment check
check('Environment', () => {
  console.log('\n[Environment]');
  const requiredVars = ['STRIPE_SECRET_KEY', 'AUTH_SECRET'];
  const missing = requiredVars.filter(v => !process.env[v]);
  
  if (missing.length === 0) {
    report('Required env vars', true, 'All present');
  } else {
    report('Required env vars', false, `Missing: ${missing.join(', ')}`);
  }

  const optionalVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ADMIN_API_KEY', 'RESEND_API_KEY'];
  const configured = optionalVars.filter(v => process.env[v]);
  report('Optional env vars', true, `${configured.length}/${optionalVars.length} configured: ${configured.join(', ') || 'none'}`);
});

// Run all checks
for (const { name, fn } of checks) {
  try {
    fn();
  } catch (e) {
    console.log(`\n[${name}] ERROR:`, e.message);
    exitCode = 1;
  }
}

console.log('\n' + '='.repeat(50));
console.log(exitCode === 0 ? 'All checks passed.' : 'Some checks failed.');
process.exit(exitCode);