function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function countMatches(text, patterns) {
  return patterns.reduce((acc, pattern) => acc + ((text.match(pattern) || []).length), 0);
}

function analyzePitch(pitch, plan = 'data') {
  const raw = (pitch || '').trim();
  if (!raw) {
    return { error: 'Pitch text is required.' };
  }

  const text = raw.toLowerCase();
  const words = raw.split(/\s+/).filter(Boolean).length;

  const sections = {
    problem: clamp(countMatches(text, [/problem/g, /pain/g, /friction/g, /expensive/g]), 0, 8) * 12,
    solution: clamp(countMatches(text, [/solution/g, /platform/g, /product/g, /automate/g]), 0, 8) * 12,
    market: clamp(countMatches(text, [/market/g, /tam/g, /sam/g, /customer/g, /segment/g]), 0, 8) * 12,
    traction: clamp(countMatches(text, [/revenue/g, /users/g, /growth/g, /retention/g, /pilot/g, /loi/g]), 0, 8) * 12,
    businessModel: clamp(countMatches(text, [/pricing/g, /subscription/g, /commission/g, /margin/g, /arpu/g]), 0, 8) * 12,
    moat: clamp(countMatches(text, [/moat/g, /defens/g, /network effect/g, /data/g, /brand/g]), 0, 8) * 12,
    ask: clamp(countMatches(text, [/raise/g, /funding/g, /runway/g, /milestone/g]), 0, 8) * 12
  };

  const sectionValues = Object.values(sections);
  let score = Math.round(sectionValues.reduce((a, b) => a + b, 0) / sectionValues.length);

  if (words < 60) score -= 12;
  if (plan === 'plus') {
    score += 6;
    if (sections.traction >= 48) score += 5;
    if (sections.businessModel >= 48) score += 4;
  }

  score = clamp(score, 1, 99);

  const label = score >= 80 ? 'Investor-ready' : score >= 65 ? 'Strong but improvable' : score >= 50 ? 'Promising but incomplete' : 'Needs significant work';

  const recommendations = [];
  if (sections.traction < 40) recommendations.push('Add concrete traction evidence (revenue, users, retention, pilots, LOIs).');
  if (sections.businessModel < 40) recommendations.push('Clarify pricing and margin model.');
  if (sections.market < 40) recommendations.push('Define your first target segment and market size assumptions.');
  if (sections.ask < 40) recommendations.push('Specify raise amount and milestone unlocked.');
  if (recommendations.length === 0) recommendations.push('Improve narrative flow and keep metrics prominent.');

  return {
    plan,
    score,
    label,
    wordCount: words,
    sections,
    recommendations
  };
}

module.exports = { analyzePitch };
