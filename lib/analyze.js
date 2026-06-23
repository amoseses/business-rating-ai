// Import the AstraPitch Offline Model
// This module integrates the offline LLM with the backend API
const fs = require('fs');
const path = require('path');
const { normalizeScore, hashPitch, generateLabel } = require('./scoring-consistency');

// Load the offline LLM code
let offlineLLMCode;
let AstraPitchOfflineModel;

try {
  // Node.js environment - load and initialize the offline llm
  const offlineLLMPath = path.join(__dirname, '../offline llm');
  offlineLLMCode = fs.readFileSync(offlineLLMPath, 'utf-8');
  
  // Parse the offline LLM to extract AstraPitchOfflineModel
  // The offline llm file exports a factory function
  const moduleExports = {};
  
  // Create execution context for the offline LLM
  const offlineLLMFunc = new Function('module', 'exports', 'require', offlineLLMCode);
  const offlineModule = { exports: {} };
  
  // Execute in isolated context
  offlineLLMFunc(offlineModule, offlineModule.exports, require);
  
  // The offline llm file should export the AstraPitchOfflineModel
  // If not directly exported, try to extract it from the code
  if (!AstraPitchOfflineModel) {
    // Fallback: eval to get the AstraPitchOfflineModel global
    const extractedCode = `
      ${offlineLLMCode}
      module.exports = AstraPitchOfflineModel;
    `;
    const extractFunc = new Function('module', 'exports', 'require', extractedCode);
    const tempModule = { exports: {} };
    extractFunc(tempModule, tempModule.exports, require);
    AstraPitchOfflineModel = tempModule.exports;
  }
} catch (err) {
  console.warn('Warning: Could not load offline LLM model:', err.message);
  // Fallback to basic analysis if LLM can't load
}

// Initialize the model once
let modelInstance = null;

function getModel() {
  if (!modelInstance && AstraPitchOfflineModel) {
    try {
      modelInstance = AstraPitchOfflineModel.create();
    } catch (err) {
      console.warn('Error initializing model:', err);
    }
  }
  return modelInstance;
}

/**
 * Analyze a pitch using the offline LLM model or fallback to basic analysis
 * @param {string} pitch - The business pitch text
 * @param {string} plan - The subscription plan (data, plus, or pro)
 * @returns {object} Analysis result with score, sections, recommendations, etc.
 */
function analyzePitch(pitch, plan = 'data') {
  if (!pitch || typeof pitch !== 'string') {
    return {
      error: 'Pitch text is required.'
    };
  }

  const raw = pitch.trim();
  if (!raw) {
    return {
      error: 'Pitch text is required.'
    };
  }

  // Try to use the offline LLM model if available
  const model = getModel();
  
  if (model) {
    try {
      return analyzeWithOfflineLLM(raw, plan, model);
    } catch (error) {
      console.error('Error using offline LLM model, falling back to basic analysis:', error.message);
      // Fall through to basic analysis
    }
  }

  // Fallback to basic analysis
  return analyzeBasic(raw, plan);
}

/**
 * Analyze using the offline LLM model
 * @param {string} pitch - The pitch text
 * @param {string} plan - The subscription plan
 * @param {object} model - The initialized model instance
 * @returns {object} Analysis result
 */
function analyzeWithOfflineLLM(pitch, plan, model) {
  // Determine analysis mode based on plan
  const analysisMode = plan === 'plus' ? 'plus' : 'basic';
  
  // Run the analysis through the offline LLM
  const analysis = model.analyze({
    pitch,
    mode: analysisMode,
    persona: 'seedvc',
    industry: 'General',
    stage: 'Pre-seed'
  });

  // Generate recommendations based on analysis
  const recommendations = generateRecommendations(analysis);

  // Apply scoring consistency normalization to the LLM score
  const wordCount = analysis.quality?.wordCount || pitch.split(/\s+/).filter(Boolean).length;
  const normalized = normalizeScore({
    rawScore: analysis.score || 0,
    sections: analysis.sections || {},
    wordCount,
    plan,
    redFlags: analysis.redFlags || [],
    missingProof: analysis.missingProof || []
  });

  // Format the result for API response
  return {
    plan: normalizePlan(plan),
    score: normalized.score,
    label: generateLabel(normalized.score),
    confidence: analysis.confidence,
    memo: analysis.memo,
    sections: analysis.sections,
    redFlags: analysis.redFlags,
    missingProof: analysis.missingProof,
    why: analysis.why,
    questions: analysis.questions,
    deck: analysis.deck,
    recommendations: recommendations,
    wordCount,
    mode: analysisMode,
    usedModel: 'offline-llm',
    normalizationPasses: normalized.passes
  };
}

/**
 * Fallback basic analysis using keyword matching
 * @param {string} pitch - The pitch text
 * @param {string} plan - The subscription plan
 * @returns {object} Analysis result
 */
function analyzeBasic(pitch, plan = 'data') {
  const text = pitch.toLowerCase();
  const words = pitch.split(/\s+/).filter(Boolean).length;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function countMatches(text, patterns) {
    return patterns.reduce((acc, pattern) => acc + ((text.match(pattern) || []).length), 0);
  }

  // Calculate base section scores with calibrated caps
  const sections = {
    Problem: clamp(countMatches(text, [/problem/g, /pain/g, /friction/g, /expensive/g]), 0, 5) * 12,
    Solution: clamp(countMatches(text, [/solution/g, /platform/g, /product/g, /automate/g]), 0, 5) * 12,
    Market: clamp(countMatches(text, [/market/g, /tam/g, /sam/g, /customer/g, /segment/g]), 0, 5) * 12,
    Traction: clamp(countMatches(text, [/revenue/g, /users/g, /growth/g, /retention/g, /pilot/g, /loi/g]), 0, 5) * 12,
    'Business model': clamp(countMatches(text, [/pricing/g, /subscription/g, /commission/g, /margin/g, /arpu/g]), 0, 5) * 12,
    Moat: clamp(countMatches(text, [/moat/g, /defens/g, /network effect/g, /data/g, /brand/g]), 0, 5) * 12,
    Ask: clamp(countMatches(text, [/raise/g, /funding/g, /runway/g, /milestone/g]), 0, 5) * 12
  };

  const sectionValues = Object.values(sections);
  const rawScore = Math.round(sectionValues.reduce((a, b) => a + b, 0) / sectionValues.length);

  // Coverage penalty: count how many sections have meaningful content (score >= 24)
  const coveredSections = Object.values(sections).filter(s => s >= 24).length;
  const coverageRatio = coveredSections / Object.keys(sections).length;

  // If less than half the sections are covered, apply a significant penalty
  let coveragePenalty = 0;
  if (coverageRatio < 0.3) {
    coveragePenalty = 25; // Very few sections addressed
  } else if (coverageRatio < 0.5) {
    coveragePenalty = 15; // Less than half addressed
  } else if (coverageRatio < 0.7) {
    coveragePenalty = 5;  // Most but not all
  }

  // Apply multi-pass scoring consistency normalization
  const normalized = normalizeScore({
    rawScore: rawScore - coveragePenalty,
    sections,
    wordCount: words,
    plan,
    redFlags: [],
    missingProof: []
  });

  const score = normalized.score;
  const label = generateLabel(score);

  const recommendations = [];
  if (sections.Traction < 40) recommendations.push('Add concrete traction evidence (revenue, users, retention, pilots, LOIs).');
  if (sections['Business model'] < 40) recommendations.push('Clarify pricing and margin model.');
  if (sections.Market < 40) recommendations.push('Define your first target segment and market size assumptions.');
  if (sections.Ask < 40) recommendations.push('Specify raise amount and milestone unlocked.');
  if (recommendations.length === 0) recommendations.push('Improve narrative flow and keep metrics prominent.');

  return {
    plan: normalizePlan(plan),
    score,
    label,
    wordCount: words,
    sections,
    recommendations,
    mode: 'basic',
    usedModel: 'keyword-fallback'
  };
}

/**
 * Generate actionable recommendations from offline LLM analysis
 * @param {object} analysis - The analysis object from the model
 * @returns {array} Array of recommendation strings
 */
function generateRecommendations(analysis) {
  const recommendations = [];

  // Add recommendations based on red flags
  if (analysis.redFlags && Array.isArray(analysis.redFlags)) {
    analysis.redFlags.forEach(flag => {
      if (flag && !flag.toLowerCase().includes('no major red flag')) {
        recommendations.push(flag);
      }
    });
  }

  // Add recommendations based on missing proof
  if (analysis.missingProof && Array.isArray(analysis.missingProof)) {
    analysis.missingProof.slice(0, 2).forEach(missing => {
      if (missing) {
        recommendations.push(missing);
      }
    });
  }

  // Add section-specific recommendations
  if (analysis.sections && typeof analysis.sections === 'object') {
    const weak = Object.entries(analysis.sections)
      .filter(([, score]) => score < 40)
      .slice(0, 2);
    
    weak.forEach(([section, score]) => {
      recommendations.push(`Strengthen ${section} (currently ${score}/100)`);
    });
  }

  // Return unique recommendations, limit to 5
  return [...new Set(recommendations.slice(0, 5))];
}

/**
 * Normalize plan name to standard format
 * @param {string} plan - The plan name
 * @returns {string} Normalized plan name
 */
function normalizePlan(plan) {
  if (!plan) return 'data';
  const lower = String(plan).toLowerCase().trim();
  if (lower === 'plus') return 'plus';
  if (lower === 'pro') return 'pro';
  return 'data';
}

module.exports = {
  analyzePitch,
  getModel,
  generateRecommendations,
  normalizePlan,
  analyzeWithOfflineLLM,
  analyzeBasic
};
