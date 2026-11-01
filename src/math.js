// ===================================================================== math.js
// Lineaire algebra (dichte matrices als Float64Array, rij-voor-rij) en statistiek.
(function (V) {
  "use strict";
  const M = {};

  M.zeros = (n) => new Float64Array(n);

  // Cholesky-inverse van een symmetrische positief-definiete n x n matrix.
  // Retourneert null als een pivot te klein is (singulier / datumdefect).
  M.cholInverse = function (A, n, tol) {
    tol = tol || 1e-10;
    const L = new Float64Array(n * n);
    for (let j = 0; j < n; j++) {
      let s = A[j * n + j];
      for (let k = 0; k < j; k++) s -= L[j * n + k] * L[j * n + k];
      if (!(s > tol)) return null;
      const d = Math.sqrt(s);
      L[j * n + j] = d;
      for (let i = j + 1; i < n; i++) {
        let t = A[i * n + j];
        for (let k = 0; k < j; k++) t -= L[i * n + k] * L[j * n + k];
        L[i * n + j] = t / d;
      }
    }
    // inverse van L (onderdriehoek)
    const Li = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      Li[i * n + i] = 1 / L[i * n + i];
      for (let j = 0; j < i; j++) {
        let s = 0;
        for (let k = j; k < i; k++) s += L[i * n + k] * Li[k * n + j];
        Li[i * n + j] = -s / L[i * n + i];
      }
    }
    // A^-1 = Li^T Li
    const X = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = 0;
        for (let k = i; k < n; k++) s += Li[k * n + i] * Li[k * n + j];
        X[i * n + j] = s; X[j * n + i] = s;
      }
    }
    return X;
  };

  // Symmetrische eigenwaarden/-vectoren (cyclische Jacobi). vecs: kolom k = eigenvector k.
  M.jacobiEig = function (A0, n) {
    const A = Float64Array.from(A0);
    const Vv = new Float64Array(n * n);
    for (let i = 0; i < n; i++) Vv[i * n + i] = 1;
    for (let sweep = 0; sweep < 60; sweep++) {
      let off = 0, diag = 0;
      for (let i = 0; i < n; i++) {
        diag += A[i * n + i] * A[i * n + i];
        for (let j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
      }
      if (off < 1e-30 * (diag + 1e-300)) break;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          const apq = A[p * n + q];
          if (Math.abs(apq) < 1e-300) continue;
          const app = A[p * n + p], aqq = A[q * n + q];
          const theta = (aqq - app) / (2 * apq);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (let k = 0; k < n; k++) {
            const akp = A[k * n + p], akq = A[k * n + q];
            A[k * n + p] = c * akp - s * akq;
            A[k * n + q] = s * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = A[p * n + k], aqk = A[q * n + k];
            A[p * n + k] = c * apk - s * aqk;
            A[q * n + k] = s * apk + c * aqk;
          }
          for (let k = 0; k < n; k++) {
            const vkp = Vv[k * n + p], vkq = Vv[k * n + q];
            Vv[k * n + p] = c * vkp - s * vkq;
            Vv[k * n + q] = s * vkp + c * vkq;
          }
        }
      }
    }
    const vals = new Float64Array(n);
    for (let i = 0; i < n; i++) vals[i] = A[i * n + i];
    return { vals, vecs: Vv };
  };

  // Inverse normaalmatrix; bij datumdefect S-basis over de coördinaat-onbekenden
  // (zoals vereffening.py: minimum-norm in de coördinaten, oriëntaties vrij).
  M.invNormal = function (N, n, coordMask) {
    if (n === 0) return { Q: new Float64Array(0), free: false, nullity: 0 };
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = Math.sqrt(Math.max(N[i * n + i], 1e-30));
    const Ns = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Ns[i * n + j] = N[i * n + j] / (d[i] * d[j]);
    const Qs = M.cholInverse(Ns, n, 1e-10);
    if (Qs) {
      const Q = new Float64Array(n * n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Q[i * n + j] = Qs[i * n + j] / (d[i] * d[j]);
      return { Q, free: false, nullity: 0 };
    }
    const { vals, vecs } = M.jacobiEig(Ns, n);
    let vmax = 0;
    for (let i = 0; i < n; i++) vmax = Math.max(vmax, vals[i]);
    const nullIdx = [], keep = [];
    for (let i = 0; i < n; i++) (vals[i] < 1e-10 * vmax ? nullIdx : keep).push(i);
    // pseudo-inverse (geschaald terug)
    const Qp = new Float64Array(n * n);
    for (const k of keep) {
      const inv = 1 / vals[k];
      for (let i = 0; i < n; i++) {
        const vi = vecs[i * n + k] * inv / d[i];
        if (vi === 0) continue;
        for (let j = 0; j < n; j++) Qp[i * n + j] += vi * vecs[j * n + k] / d[j];
      }
    }
    // G = nulruimte (ongeschaald): U[:,null] / d
    const g = nullIdx.length;
    const G = new Float64Array(n * g);
    for (let i = 0; i < n; i++) for (let k = 0; k < g; k++) G[i * g + k] = vecs[i * n + nullIdx[k]] / d[i];
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = coordMask ? (coordMask[i] ? 1 : 0) : 1;
    // GtWG (g x g) en inverse
    const GtWG = new Float64Array(g * g);
    for (let a = 0; a < g; a++) for (let b = 0; b < g; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += G[i * g + a] * w[i] * G[i * g + b];
      GtWG[a * g + b] = s;
    }
    const Gi = M.generalInverse(GtWG, g);
    // S = I - G Gi G^T W
    const H = new Float64Array(n * g); // G Gi
    for (let i = 0; i < n; i++) for (let b = 0; b < g; b++) {
      let s = 0;
      for (let a = 0; a < g; a++) s += G[i * g + a] * Gi[a * g + b];
      H[i * g + b] = s;
    }
    const S = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      let s = 0;
      for (let b = 0; b < g; b++) s += H[i * g + b] * G[j * g + b];
      S[i * n + j] = (i === j ? 1 : 0) - s * w[j];
    }
    const SQ = M.matMul(S, Qp, n, n, n);
    const Q = M.matMulT(SQ, S, n, n, n);
    return { Q, free: true, nullity: g };
  };

  // Gauss-Jordan inverse (klein, algemeen)
  M.generalInverse = function (A0, n) {
    const A = Float64Array.from(A0), I = new Float64Array(n * n);
    for (let i = 0; i < n; i++) I[i * n + i] = 1;
    for (let c = 0; c < n; c++) {
      let p = c, best = Math.abs(A[c * n + c]);
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > best) { best = Math.abs(A[r * n + c]); p = r; }
      if (best < 1e-300) return null;
      if (p !== c) for (let k = 0; k < n; k++) {
        let t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t;
        t = I[c * n + k]; I[c * n + k] = I[p * n + k]; I[p * n + k] = t;
      }
      const piv = A[c * n + c];
      for (let k = 0; k < n; k++) { A[c * n + k] /= piv; I[c * n + k] /= piv; }
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r * n + c];
        if (f === 0) continue;
        for (let k = 0; k < n; k++) { A[r * n + k] -= f * A[c * n + k]; I[r * n + k] -= f * I[c * n + k]; }
      }
    }
    return I;
  };

  M.matMul = function (A, B, n, k, m) { // (n x k)(k x m)
    const C = new Float64Array(n * m);
    for (let i = 0; i < n; i++) for (let p = 0; p < k; p++) {
      const a = A[i * k + p];
      if (a === 0) continue;
      for (let j = 0; j < m; j++) C[i * m + j] += a * B[p * m + j];
    }
    return C;
  };
  M.matMulT = function (A, B, n, k, m) { // A (n x k) * B^T, B is (m x k)
    const C = new Float64Array(n * m);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      let s = 0;
      for (let p = 0; p < k; p++) s += A[i * k + p] * B[j * k + p];
      C[i * m + j] = s;
    }
    return C;
  };

  // ------------------------------------------------------------- statistiek
  function erfc(x) { // Numerical Recipes erfcc, rel. fout < 1.2e-7; verfijnd hieronder
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  M.normCdf = (x) => 0.5 * erfc(-x / Math.SQRT2);
  M.normPpf = function (p) { // Acklam + Newton-verfijning
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425;
    let x;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    else if (p <= 1 - pl) { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    else { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    return x;
  };
  function lnGamma(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += g[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  M.lnGamma = lnGamma;
  function gammaP(a, x) { // geregulariseerde onvolledige gammafunctie P(a,x)
    if (x <= 0) return 0;
    if (x < a + 1) {
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 0; n < 2000; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
      return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    }
    let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
    for (let i = 1; i < 2000; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  }
  M.gammaP = gammaP;
  // niet-centrale chi-kwadraat: overschrijdingskans
  M.ncx2Sf = function (x, k, lam) {
    const mu = lam / 2;
    const jmax = Math.ceil(mu + 12 * Math.sqrt(mu + 1) + 40);
    let cdf = 0;
    for (let j = 0; j <= jmax; j++) {
      const lw = -mu + (j > 0 ? j * Math.log(mu) : 0) - lnGamma(j + 1);
      cdf += Math.exp(lw) * gammaP(k / 2 + j, x / 2);
    }
    return 1 - cdf;
  };
  M.ncx2Isf = function (q, k, lam) {
    let lo = 0, hi = k + lam + 40 * Math.sqrt(2 * (k + 2 * lam)) + 100;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (M.ncx2Sf(mid, k, lam) > q) lo = mid; else hi = mid;
      if (hi - lo < 1e-10 * Math.max(1, hi)) break;
    }
    return (lo + hi) / 2;
  };

  M.median = function (a) {
    const s = [...a].sort((x, y) => x - y), n = s.length;
    if (!n) return NaN;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  M.mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  M.std1 = function (a) {
    if (a.length < 2) return 0;
    const m = M.mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  };
  M.isNum = (v) => typeof v === "number" && v === v;

  V.M = M;
})(globalThis.V = globalThis.V || {});
