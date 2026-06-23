/**
 * Scoring consistency improvements.
 * Multi-pass scoring normalization to reduce variance and improve reliability.
 * Applies statistical smoothing, cross-referencing, and plan-aware adjustments.
 */
const crypto = require('crypto');

/**
 * Run a multi-pass consistency check on a score.
 * Takes the raw score from the model and applies normalization passes.
 * @param {object} params
 * @param {number} params.rawScore - The initial score from analysis (1-99)
 * @param {object} params.sections - Section scores object {name: score}
 * @param {number} params.wordCount - Word count of the pitch
 * @param {string} params.plan - 'data' or 'plus'
 * @param {Array} params.redFlags - Any red flags found
 * @param {Array} params.missingProof - Missing proof items
 * @returns {object} { score, passes, adjustments }
 */
function normalizeScore({ rawScore, sections, wordCount, plan, redFlags = [], missingProof = [] }) {
  let score = rawScore;
  const passes = [];
  const adjustments = [];

  // --- Pass 1: Word count penalty ---
  // Very short pitches can't be properly evaluated
  if (wordCount < 50) {
    const penalty = Math.min(15, Math.round((50 - wordCount) * 0.3));
    score -= penalty;
    passes.push({ pass: 1, name: 'word_count_penalty', adjustment: -penalty, reason: `Pitch too short (${wordCount} words)` });
    adjustments.push(-penalty);
  }

  // --- Pass 2: Section score consistency ---
  // If sections have high variance, reduce score to reflect uneven quality
  if (sections && typeof sections === 'object') {
    const sectionValues = Object.values(sections).filter(v => typeof v === 'number');
    if (sectionValues.length > 0) {
      const maxVal = Math.max(...sectionValues);
      const minVal = Math.min(...sectionValues);
      const variance = maxVal - minVal;

      if (variance > 60) {
        // Very uneven pitch - penalize for lack of balance
        const penalty = Math.min(8, Math.round(variance * 0.08));
        score -= penalty;
        passes.push({ pass: 2, name: 'section_balance_penalty', adjustment: -penalty, reason: `High section variance (${variance} pts)` });
        adjustments.push(-penalty);
      }

      // Bonus for strong consistency across sections
      if (variance < 20 && sectionValues.every(v => v >= 40)) {
        const bonus = 3;
        score += bonus;
        passes.push({ pass: 2, name: 'section_consistency_bonus', adjustment: bonus, reason: 'Consistent section scores' });
        adjustments.push(bonus);
      }
    }
  }

  // --- Pass 3: Red flag de-duplication ---
  // Each unique red flag category reduces score
  const uniqueRedFlags = [...new Set(redFlags.map(f => f.toLowerCase().trim()))];
  const meaningfulFlags = uniqueRedFlags.filter(f => 
    !f.includes('no major red flag') && 
    !f.includes('none found') &&
    !f.includes('no red flags')
  );

  if (meaningfulFlags.length > 0) {
    const penalty = Math.min(10, meaningfulFlags.length * 4);
    score -= penalty;
    passes.push({ pass: 3, name: 'red_flag_penalty', adjustment: -penalty, reason: `${meaningfulFlags.length} unique red flag(s)` });
    adjustments.push(-penalty);
  }

  // --- Pass 4: Missing proof penalty ---
  if (missingProof && missingProof.length > 0) {
    const penalty = Math.min(8, missingProof.length * 3);
    score -= penalty;
    passes.push({ pass: 4, name: 'missing_proof_penalty', adjustment: -penalty, reason: `${missingProof.length} missing proof item(s)` });
    adjustments.push(-penalty);
  }

  // --- Pass 5: Plan-specific adjustments ---
  if (plan === 'plus') {
    // Plus plan gets a small boost for more detailed analysis
    const boost = 3;
    score += boost;
    passes.push({ pass: 5, name: 'plus_plan_boost', adjustment: boost, reason: 'Plus plan analysis premium' });
    adjustments.push(boost);
  }

  // --- Pass 6: Rounding and clamp ---
  score = Math.round(score);
  const clampedScore = Math.max(1, Math.min(99, score));

  if (clampedScore !== score) {
    passes.push({ pass: 6, name: 'clamp', adjustment: clampedScore - score, reason: `Clamped to ${clampedScore} (was ${score})` });
    adjustments.push(clampedScore - score);
    score = clampedScore;
  }

  return {
    score,
    passes,
    adjustments,
    adjustedScore: score
  };
}

/**
 * Generate a deterministic hash of pitch text for deduplication.
 * @param {string} pitch - The pitch text
 * @returns {string} SHA-256 hash
 */
function hashPitch(pitch) {
  if (!pitch) return '';
  return crypto.createHash('sha256').update(pitch.trim().toLowerCase()).digest('hex');
}

/**
 * Analyze pitch similarity between two analysis results for consistency checking.
 * @param {object} resultA
 * @param {object} resultB
 * @returns {number} Similarity score 0-1
 */
function scoreSimilarity(resultA, resultB) {
  if (!resultA || !resultB) return 0;

  const diff = Math.abs((resultA.score || 0) - (resultB.score || 0));
  const maxPossibleDiff = 99;

  // 1.0 = identical scores, 0.0 = max possible difference
  return Math.max(0, 1 - (diff / maxPossibleDiff));
}

/**
 * Generate a human-readable label based on the final score.
 * @param {number} score - Final normalized score (1-99)
 * @returns {string} Label string
 */
function generateLabel(score) {
  if (score >= 90) return 'Exceptional — investor-ready';
  if (score >= 80) return 'Investor-ready';
  if (score >= 70) return 'Strong with minor gaps';
  if (score >= 60) return 'Promising but incomplete';
  if (score >= 50) return 'Needs significant work';
  if (score >= 40) return 'Early stage — needs development';
  return 'Not ready — needs major revision';
}

module.exports = {
  normalizeScore,
  hashPitch,
  scoreSimilarity,
  generateLabel
};