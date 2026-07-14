/* Password strength — entropy, not rule-checkboxes (password-field.md #1–2).
   Strength is the number of guesses an attacker needs, so length dominates
   symbol decoration. Dependency-free; mirrored byte-for-byte in
   src/data/password.js on the web frontend. Keep the two in sync. */

export type PasswordScore = 0 | 1 | 2 | 3;

export interface PasswordStrength {
  bits: number;
  score: PasswordScore;
  word: string;
  reasons: string[];
}

export interface PasswordRule {
  key: string;
  label: string;
  ok: boolean;
}

const CLASSES = [
  { re: /[a-z]/, size: 26 },
  { re: /[A-Z]/, size: 26 },
  { re: /[0-9]/, size: 10 },
  { re: /[^a-zA-Z0-9]/, size: 33 },
];

/* Anything on this list is guessed in the attacker's first few thousand tries,
   whatever its charset math says. */
const COMMON = new Set([
  'password', 'password1', 'passw0rd', '12345678', '123456789', '1234567890',
  'qwerty', 'qwertyui', 'letmein', 'welcome', 'iloveyou', 'admin123',
  'abc12345', 'monkey123', 'football', 'baseball', 'dragon123', 'sunshine',
  'princess', 'trustno1', 'starwars', 'whatever', 'pesalens', 'pesalens1',
]);

const SEPARATORS = /[\s\-_.+]/;

/* The three rules the backend actually enforces. Surfaced as a secondary,
   always-visible checklist (password-field.md #3) — never as the primary score. */
export function passwordRules(pw = ''): PasswordRule[] {
  return [
    { key: 'len', label: 'At least 8 characters', ok: pw.length >= 8 },
    { key: 'letter', label: 'Contains a letter', ok: /[A-Za-z]/.test(pw) },
    { key: 'number', label: 'Contains a number', ok: /\d/.test(pw) },
  ];
}

export function passwordRulesMet(pw = ''): boolean {
  return passwordRules(pw).every((r) => r.ok);
}

/* Collapse runs of the same character ("aaaa" → "a") and obvious ascending or
   descending sequences ("abcd", "4321") before measuring. An attacker's
   dictionary covers these, so they must not inflate the length term. */
function effectiveLength(pw: string): number {
  let n = 0;
  let runDir = 0;
  for (let i = 0; i < pw.length; i++) {
    if (i === 0) { n += 1; continue; }
    const delta = pw.charCodeAt(i) - pw.charCodeAt(i - 1);
    const inRun = delta === runDir && (delta === 0 || delta === 1 || delta === -1);
    if (inRun) n += 0.25;
    else { n += 1; runDir = delta === 0 || delta === 1 || delta === -1 ? delta : 0; }
  }
  return n;
}

const WORDS = ['Weak', 'Fair', 'Almost', 'Strong'];

/**
 * `score` indexes a 4-segment meter; `word` is the rating that must accompany the
 * colour so the signal survives colour-blindness (password-field.md #5).
 * `reasons` are the attribution chips explaining what earned each gain (#6).
 */
export function passwordStrength(pw = ''): PasswordStrength {
  if (!pw) return { bits: 0, score: 0, word: '', reasons: [] };

  const charset = CLASSES.reduce((sum, c) => (c.re.test(pw) ? sum + c.size : sum), 0);
  const bits = charset > 1 ? Math.round(effectiveLength(pw) * Math.log2(charset)) : 0;

  const reasons = ['first chars'];
  if (pw.split(SEPARATORS).filter(Boolean).length > 1) reasons.push('+ multiple words');
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) reasons.push('+ mixed case');
  if (/\d/.test(pw)) reasons.push('+ a number');
  if (/[^a-zA-Z0-9]/.test(pw)) reasons.push('+ a symbol');
  if (pw.length >= 16) reasons.push(`+ ${pw.length} characters`);

  let score: PasswordScore = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : 3;
  if (COMMON.has(pw.toLowerCase())) score = 0;

  return { bits, score, word: WORDS[score], reasons };
}
