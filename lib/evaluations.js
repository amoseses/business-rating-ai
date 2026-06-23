/**
 * Test evaluation runner.
 * Runs automated evaluations across multiple pitch types to measure
 * scoring consistency, accuracy, and performance.
 */
const { analyzePitch } = require('./analyze');
const { normalizeScore, hashPitch, scoreSimilarity, generateLabel } = require('./scoring-consistency');
const { getSupabase } = require('./supabase');

/**
 * Pre-defined test pitches across different types for evaluation.
 */
const TEST_PITCHES = {
  saas: {
    type: 'saas',
    text: `We are building a next-generation project management platform for remote teams. Our solution uses AI to automatically prioritize tasks based on deadlines, team workload, and business impact. We have 2,000 paying customers and $500K ARR growing at 15% month-over-month. Our pricing starts at $29/user/month with an enterprise tier at $99/user/month. The global project management software market is $8B and growing at 12% CAGR. We are raising a $2M seed round to expand our engineering team and accelerate go-to-market. Our main competitors are Asana and Monday.com, but we differentiate with AI-native features and a superior remote-first experience. We have 5 LOIs from enterprise customers and a pilot with a Fortune 500 company.`,
    expectedScoreMin: 50,
    expectedScoreMax: 92
  },
  hardware: {
    type: 'hardware',
    text: `We are developing a smart water monitoring device for agricultural use. Our IoT sensors measure soil moisture, temperature, and nutrient levels in real-time. We have completed our prototype and are currently testing with 10 farms in California. The agricultural IoT market is projected to reach $30B by 2030. We have filed 2 provisional patents. Our device costs $200 to manufacture and we plan to sell for $500. We are raising a $1.5M seed round for tooling and initial production run. Our team has 20 years of combined experience in agtech and hardware engineering.`,
    expectedScoreMin: 40,
    expectedScoreMax: 80
  },
  marketplace: {
    type: 'marketplace',
    text: `We are building a peer-to-peer marketplace for freelance creative professionals. Our platform connects graphic designers, video editors, and copywriters with small businesses. We have 500 freelancers and 200 businesses on the platform. We take a 15% commission on each transaction. Monthly GMV is $50K and growing 20% month-over-month. The freelance marketplace market is $3.5B. We are raising a $1M seed round. Our key differentiator is AI-powered matching that reduces the time to find the right freelancer from days to hours. We have strong unit economics with a 3x LTV/CAC ratio.`,
    expectedScoreMin: 40,
    expectedScoreMax: 85
  },
  biotech: {
    type: 'biotech',
    text: `We are a biotech company developing a novel drug delivery platform using lipid nanoparticles. Our technology can encapsulate mRNA and small molecule drugs for targeted delivery to specific cell types. We have completed preclinical studies showing 3x improvement in drug bioavailability. We are in discussions with 2 major pharmaceutical companies for partnership. The targeted drug delivery market is $100B+. We have a strong scientific advisory board including a Nobel laureate. We are raising a $5M Series A for IND-enabling studies and initial clinical trials. Our IP portfolio includes 3 patent families.`,
    expectedScoreMin: 35,
    expectedScoreMax: 85
  },
  consumer_app: {
    type: 'consumer_app',
    text: `We are launching a social fitness app that uses AI to generate personalized workout plans. Users can compete with friends, track progress, and get real-time form correction using computer vision. We have 50,000 downloads and 10,000 monthly active users. Our retention rate is 40% at 30 days. We monetize through a $9.99/month subscription with 5% conversion rate. The digital fitness market is $15B. We are raising a $750K pre-seed round. Our team previously built a health app that was acquired by a major insurance company.`,
    expectedScoreMin: 45,
    expectedScoreMax: 85
  },
  weak_pitch: {
    type: 'weak_pitch',
    text: `We have an idea for an app. It will be like Uber but for something else. We think it will be big. We need funding to build it. We don't have any customers yet but we think people will like it. Our team is good. We will figure out the business model later.`,
    expectedScoreMin: 1,
    expectedScoreMax: 40
  }
};

/**
 * Run a single evaluation test.
 * @param {string} testName - Name of the test
 * @param {string} pitchText - The pitch to analyze
 * @param {number} expectedScoreMin - Minimum acceptable score
 * @param {number} expectedScoreMax - Maximum acceptable score
 * @param {string} plan - 'data' or 'plus'
 * @returns {Promise<object>} Evaluation result
 */
async function runSingleEvaluation(testName, pitchText, expectedScoreMin, expectedScoreMax, plan = 'data') {
  const start = Date.now();

  try {
    const result = analyzePitch(pitchText, plan);
    const executionTimeMs = Date.now() - start;

    const actualScore = result.score || 0;
    const passed = actualScore >= expectedScoreMin && actualScore <= expectedScoreMax;

    return {
      testName,
      pitchType: testName,
      pitchText: pitchText.substring(0, 200), // Store truncated for reference
      expectedScoreMin,
      expectedScoreMax,
      actualScore,
      passed,
      modelUsed: result.usedModel || 'unknown',
      executionTimeMs,
      sections: result.sections || {},
      recommendations: result.recommendations || [],
      label: result.label || '',
      wordCount: result.wordCount || 0
    };
  } catch (error) {
    return {
      testName,
      pitchType: testName,
      pitchText: pitchText.substring(0, 200),
      expectedScoreMin,
      expectedScoreMax,
      actualScore: 0,
      passed: false,
      modelUsed: 'error',
      executionTimeMs: Date.now() - start,
      error: error.message
    };
  }
}

/**
 * Run the full evaluation suite across all pitch types.
 * @param {object} options
 * @param {string} [options.plan='data'] - Plan to test with
 * @param {boolean} [options.persist=true] - Whether to save results to Supabase
 * @param {Array} [options.pitchTypes] - Specific pitch types to test (default: all)
 * @returns {Promise<object>} { results, summary }
 */
async function runEvaluationSuite({ plan = 'data', persist = true, pitchTypes } = {}) {
  const pitchesToTest = pitchTypes
    ? Object.entries(TEST_PITCHES).filter(([key]) => pitchTypes.includes(key))
    : Object.entries(TEST_PITCHES);

  const results = [];

  for (const [testName, config] of pitchesToTest) {
    const result = await runSingleEvaluation(
      testName,
      config.text,
      config.expectedScoreMin,
      config.expectedScoreMax,
      plan
    );
    results.push(result);

    // Also run with plus plan for comparison if testing data plan
    if (plan === 'data') {
      const plusResult = await runSingleEvaluation(
        `${testName}_plus`,
        config.text,
        config.expectedScoreMin,
        config.expectedScoreMax,
        'plus'
      );
      results.push(plusResult);
    }
  }

  // Calculate summary
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const avgScore = Math.round(results.reduce((sum, r) => sum + r.actualScore, 0) / total);
  const avgTime = Math.round(results.reduce((sum, r) => sum + r.executionTimeMs, 0) / total);

  const summary = {
    total,
    passed,
    failed,
    passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
    averageScore: avgScore,
    averageExecutionTimeMs: avgTime,
    plan,
    timestamp: new Date().toISOString()
  };

  // Persist to Supabase if configured
  if (persist) {
    await persistEvaluationResults(results, summary);
  }

  return { results, summary };
}

/**
 * Save evaluation results to Supabase.
 * @param {Array} results - Array of evaluation result objects
 * @param {object} summary - Summary statistics
 * @returns {Promise<boolean>}
 */
async function persistEvaluationResults(results, summary) {
  try {
    const supabase = getSupabase();

    for (const result of results) {
      const { error } = await supabase
        .from('evaluation_results')
        .insert([{
          test_name: result.testName,
          pitch_type: result.pitchType,
          pitch_text: result.pitchText,
          expected_score_min: result.expectedScoreMin,
          expected_score_max: result.expectedScoreMax,
          actual_score: result.actualScore,
          passed: result.passed,
          model_used: result.modelUsed,
          execution_time_ms: result.executionTimeMs
        }]);

      if (error) {
        console.warn('[Evaluations] Failed to persist result:', error.message);
      }
    }

    return true;
  } catch (err) {
    console.warn('[Evaluations] Failed to persist results:', err.message);
    return false;
  }
}

/**
 * Get historical evaluation results for trend analysis.
 * @param {object} params
 * @param {number} [params.limit=50]
 * @param {boolean} [params.onlyFailed]
 * @returns {Promise<Array>}
 */
async function getEvaluationHistory({ limit = 50, onlyFailed = false } = {}) {
  try {
    const supabase = getSupabase();
    let query = supabase
      .from('evaluation_results')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (onlyFailed) {
      query = query.eq('passed', false);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[Evaluations] Failed to fetch history:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[Evaluations] Error fetching history:', err.message);
    return [];
  }
}

/**
 * Get the latest evaluation summary.
 * @returns {Promise<object|null>}
 */
async function getLatestEvaluationSummary() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('evaluation_results')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) return null;

    const total = data.length;
    const passed = data.filter(r => r.passed).length;
    const avgScore = Math.round(data.reduce((sum, r) => sum + r.actual_score, 0) / total);
    const avgTime = Math.round(data.reduce((sum, r) => sum + r.execution_time_ms, 0) / total);

    return {
      total,
      passed,
      failed: total - passed,
      passRate: Math.round((passed / total) * 100),
      averageScore: avgScore,
      averageExecutionTimeMs: avgTime,
      latestRun: data[0]?.created_at
    };
  } catch (err) {
    console.warn('[Evaluations] Error getting summary:', err.message);
    return null;
  }
}

module.exports = {
  runSingleEvaluation,
  runEvaluationSuite,
  getEvaluationHistory,
  getLatestEvaluationSummary,
  TEST_PITCHES
};