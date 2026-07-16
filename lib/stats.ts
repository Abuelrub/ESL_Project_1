// ============================================================
// STATISTICS — real tests computed in-app (no external tools)
// Welch's t-test, paired t-test, Pearson correlation, with
// two-tailed p-values from the Student t distribution.
// ============================================================

export const mean = (a: number[]) =>
  a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

export const sd = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

export const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// ---- Student t distribution p-value (two-tailed) via incomplete beta ----
function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function ibeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) +
    a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? bt * betacf(a, b, x) / a
    : 1 - bt * betacf(b, a, 1 - x) / b;
}

export function tPValue(t: number, df: number): number {
  if (!isFinite(t) || df <= 0) return 1;
  return ibeta(df / 2, 0.5, df / (df + t * t));
}

export interface TestResult {
  n1: number; n2: number; m1: number; m2: number;
  sd1: number; sd2: number; t: number; df: number; p: number;
  significant: boolean; valid: boolean;
}

// Welch's t-test (unequal variances) for two independent groups
export function welchT(a: number[], b: number[]): TestResult {
  const n1 = a.length, n2 = b.length;
  const base = { n1, n2, m1: mean(a), m2: mean(b), sd1: sd(a), sd2: sd(b) };
  if (n1 < 3 || n2 < 3) return { ...base, t: 0, df: 0, p: 1, significant: false, valid: false };
  const v1 = sd(a) ** 2 / n1, v2 = sd(b) ** 2 / n2;
  const se = Math.sqrt(v1 + v2);
  if (se === 0) return { ...base, t: 0, df: 0, p: 1, significant: false, valid: false };
  const t = (mean(a) - mean(b)) / se;
  const df = (v1 + v2) ** 2 / (v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1));
  const p = tPValue(t, df);
  return { ...base, t, df, p, significant: p < 0.05, valid: true };
}

// Paired t-test (e.g. same students in two conditions)
export function pairedT(x: number[], y: number[]): TestResult {
  const n = Math.min(x.length, y.length);
  const diffs = Array.from({ length: n }, (_, i) => x[i] - y[i]);
  const base = { n1: n, n2: n, m1: mean(x.slice(0, n)), m2: mean(y.slice(0, n)), sd1: sd(x.slice(0, n)), sd2: sd(y.slice(0, n)) };
  if (n < 3) return { ...base, t: 0, df: 0, p: 1, significant: false, valid: false };
  const sdd = sd(diffs);
  if (sdd === 0) return { ...base, t: 0, df: n - 1, p: 1, significant: false, valid: false };
  const t = mean(diffs) / (sdd / Math.sqrt(n));
  const p = tPValue(t, n - 1);
  return { ...base, t, df: n - 1, p, significant: p < 0.05, valid: true };
}

export interface CorrResult {
  r: number; n: number; t: number; df: number; p: number;
  significant: boolean; valid: boolean;
}

// Pearson correlation with significance test
export function pearson(x: number[], y: number[]): CorrResult {
  const n = Math.min(x.length, y.length);
  if (n < 4) return { r: 0, n, t: 0, df: 0, p: 1, significant: false, valid: false };
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return { r: 0, n, t: 0, df: n - 2, p: 1, significant: false, valid: false };
  const r = num / Math.sqrt(dx * dy);
  const t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
  const p = tPValue(t, n - 2);
  return { r, n, t, df: n - 2, p, significant: p < 0.05, valid: true };
}

export const fmtP = (p: number) => (p < 0.001 ? "p < .001" : `p = ${p.toFixed(3)}`);
export const fmt = (v: number, d = 1) => (isFinite(v) ? v.toFixed(d) : "—");
