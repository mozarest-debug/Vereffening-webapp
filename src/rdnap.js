// ===================================================================== rdnap.js
// RDNAPTRANS(TM)2018 variant 1 (NSGI-specificatie 27-06-2022), ETRS89 <-> RD/NAP.
(function (V) {
  "use strict";
  const DEG = Math.PI / 180;
  const A_GRS80 = 6378137.0, F_GRS80 = 1 / 298.257222101;
  const A_BES = 6377397.155, F_BES = 1 / 299.1528128;
  const H0_ETRS = 43.0, H0_BES = 0.0;
  const P_ETRS_RD = { tx: -565.7346, ty: -50.4058, tz: -465.2895, a: -1.91513e-6, b: 1.60365e-6, g: -9.09546e-6, d: -4.07242e-6 };
  const P_RD_ETRS = { tx: 565.7381, ty: 50.4018, tz: 465.2904, a: 1.91514e-6, b: -1.60363e-6, g: 9.09546e-6, d: 4.07244e-6 };
  const PHI0 = (52 + 9 / 60 + 22.178 / 3600) * DEG, LAM0 = (5 + 23 / 60 + 15.5 / 3600) * DEG;
  const K_RD = 0.9999079, X0 = 155000.0, Y0 = 463000.0;
  const EPS_DEG = 1e-9, EPS_RAD = 1e-14;
  const e2f = (f) => f * (2 - f);

  function geodToCart(lat, lon, h, a, f) {
    const e2 = e2f(f), s = Math.sin(lat);
    const rn = a / Math.sqrt(1 - e2 * s * s);
    return [(rn + h) * Math.cos(lat) * Math.cos(lon), (rn + h) * Math.cos(lat) * Math.sin(lon), (rn * (1 - e2) + h) * s];
  }
  function cartToGeod(X, Y, Z, a, f) {
    const e2 = e2f(f), p = Math.hypot(X, Y);
    let lat = 0;
    for (let i = 0; i < 50; i++) {
      const rn = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
      const nw = Math.atan2(Z + e2 * rn * Math.sin(lat), p);
      const done = Math.abs(nw - lat) < EPS_RAD;
      lat = nw;
      if (done) break;
    }
    const lon = Math.atan2(Y, X);
    const rn = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    return [lat, lon, p / Math.cos(lat) - rn];
  }
  function helmert(X, Y, Z, p) {
    const ca = Math.cos(p.a), sa = Math.sin(p.a), cb = Math.cos(p.b), sb = Math.sin(p.b), cg = Math.cos(p.g), sg = Math.sin(p.g);
    const s = 1 + p.d;
    const R = [[cg * cb, cg * sb * sa + sg * ca, -cg * sb * ca + sg * sa],
      [-sg * cb, -sg * sb * sa + cg * ca, sg * sb * ca + cg * sa],
      [sb, -cb * sa, cb * ca]];
    return [s * (R[0][0] * X + R[0][1] * Y + R[0][2] * Z) + p.tx,
      s * (R[1][0] * X + R[1][1] * Y + R[1][2] * Z) + p.ty,
      s * (R[2][0] * X + R[2][1] * Y + R[2][2] * Z) + p.tz];
  }

  // Grid: {latmin, lonmin, dlat, dlon, nlat, nlon, vals: [Float64Array, ...]} (ZW -> NO, west-oost eerst)
  class Grid {
    constructor(g) {
      Object.assign(this, g);
      this.latmax = this.latmin + (this.nlat - 1) * this.dlat;
      this.lonmax = this.lonmin + (this.nlon - 1) * this.dlon;
    }
    inside(lat, lon, tol = 1e-8) {
      return lat >= this.latmin - tol && lat <= this.latmax + tol && lon >= this.lonmin - tol && lon <= this.lonmax + tol;
    }
    interp(lat, lon, c0) {
      if (!this.inside(lat, lon)) return this.vals.map(() => c0);
      const fl = Math.min(Math.max((lat - this.latmin) / this.dlat, 0), this.nlat - 1);
      const fo = Math.min(Math.max((lon - this.lonmin) / this.dlon, 0), this.nlon - 1);
      const i0 = Math.min(Math.max(Math.floor(fl), 0), this.nlat - 2);
      const j0 = Math.min(Math.max(Math.floor(fo), 0), this.nlon - 2);
      const tl = fl - i0, to = fo - j0, n = this.nlon;
      return this.vals.map((v) => {
        const sw = v[i0 * n + j0], se = v[i0 * n + j0 + 1], nw = v[(i0 + 1) * n + j0], ne = v[(i0 + 1) * n + j0 + 1];
        return tl * (nw * (1 - to) + ne * to) + (1 - tl) * (sw * (1 - to) + se * to);
      });
    }
  }
  // Grid uit NSGI-ASCII-tekst (kopregel + lat lon waarde(n))
  Grid.fromText = function (txt, ncols) {
    const lines = txt.split(/\r?\n/).slice(1).filter((l) => l.trim());
    const n = lines.length;
    const lat = new Float64Array(n), lon = new Float64Array(n), vals = [];
    for (let k = 0; k < ncols; k++) vals.push(new Float64Array(n));
    for (let i = 0; i < n; i++) {
      const p = lines[i].trim().split(/\s+/);
      lat[i] = +p[0]; lon[i] = +p[1];
      for (let k = 0; k < ncols; k++) vals[k][i] = +p[2 + k];
    }
    const lats = [...new Set(Array.from(lat, (v) => v.toFixed(6)))].map(Number).sort((a, b) => a - b);
    const lons = [...new Set(Array.from(lon, (v) => v.toFixed(6)))].map(Number).sort((a, b) => a - b);
    return new Grid({ latmin: lats[0], lonmin: lons[0], dlat: Math.round((lats[1] - lats[0]) * 1e9) / 1e9, dlon: Math.round((lons[1] - lons[0]) * 1e9) / 1e9, nlat: lats.length, nlon: lons.length, vals });
  };
  // Grid uit compacte vorm: Int32-waarden (base64) x schaal
  Grid.fromPacked = function (meta, b64list) {
    const vals = b64list.map((b64) => {
      const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
      const buf = new ArrayBuffer(bin.length), u8 = new Uint8Array(buf);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const i32 = new Int32Array(buf), out = new Float64Array(i32.length);
      for (let i = 0; i < i32.length; i++) out[i] = i32[i] * meta.scale;
      return out;
    });
    return new Grid({ latmin: meta.latmin, lonmin: meta.lonmin, dlat: meta.dlat, dlon: meta.dlon, nlat: meta.nlat, nlon: meta.nlon, vals });
  };

  // RD-projectie
  const eB = Math.sqrt(e2f(F_BES)), e2B = e2f(F_BES);
  const iso = (phi, e) => Math.log(Math.tan(phi / 2 + Math.PI / 4)) - e / 2 * Math.log((1 + e * Math.sin(phi)) / (1 - e * Math.sin(phi)));
  const nC = Math.sqrt(1 + e2B * Math.cos(PHI0) ** 4 / (1 - e2B));
  const RN0 = A_BES / Math.sqrt(1 - e2B * Math.sin(PHI0) ** 2);
  const RM0 = RN0 * (1 - e2B) / (1 - e2B * Math.sin(PHI0) ** 2);
  const Rs = Math.sqrt(RM0 * RN0);
  const q0 = iso(PHI0, eB);
  const PHI0s = Math.atan(Math.sqrt(RM0) / Math.sqrt(RN0) * Math.tan(PHI0));
  const w0 = Math.log(Math.tan(PHI0s / 2 + Math.PI / 4));
  const mC = w0 - nC * q0;
  const LAM0s = LAM0;

  function besselToRd(lat, lon) {
    const q = iso(lat, eB), w = nC * q + mC;
    const PHI = 2 * Math.atan(Math.exp(w)) - Math.PI / 2;
    const LAM = LAM0s + nC * (lon - LAM0);
    const sp2 = Math.sqrt(Math.sin((PHI - PHI0s) / 2) ** 2 + Math.sin((LAM - LAM0s) / 2) ** 2 * Math.cos(PHI) * Math.cos(PHI0s));
    if (sp2 < 1e-15) return [X0, Y0];
    const cp2 = Math.sqrt(1 - sp2 * sp2);
    const sa = Math.sin(LAM - LAM0s) * Math.cos(PHI) / (2 * sp2 * cp2);
    const ca = (Math.sin(PHI) - Math.sin(PHI0s) + 2 * Math.sin(PHI0s) * sp2 * sp2) / (2 * Math.cos(PHI0s) * sp2 * cp2);
    const r = 2 * K_RD * Rs * sp2 / cp2;
    return [r * sa + X0, r * ca + Y0];
  }
  function rdToBessel(x, y) {
    const dx = x - X0, dy = y - Y0, r = Math.hypot(dx, dy);
    const sa = r > 0 ? dx / r : 0, ca = r > 0 ? dy / r : 0;
    const psi = 2 * Math.atan(r / (2 * K_RD * Rs));
    const Xb = Math.cos(PHI0s) * Math.cos(psi) - ca * Math.sin(PHI0s) * Math.sin(psi);
    const Yb = sa * Math.sin(psi);
    const Zb = ca * Math.cos(PHI0s) * Math.sin(psi) + Math.sin(PHI0s) * Math.cos(psi);
    const PHI = Math.asin(Math.min(1, Math.max(-1, Zb)));
    const LAM = LAM0s + Math.atan2(Yb, Xb);
    const w = Math.log(Math.tan(PHI / 2 + Math.PI / 4));
    const q = (w - mC) / nC;
    let lat = 0;
    for (let i = 0; i < 50; i++) {
      const nw = 2 * Math.atan(Math.exp(q + eB / 2 * Math.log((1 + eB * Math.sin(lat)) / (1 - eB * Math.sin(lat))))) - Math.PI / 2;
      const done = Math.abs(nw - lat) < EPS_RAD;
      lat = nw;
      if (done) break;
    }
    const lonN = (LAM - LAM0s) / nC + LAM0;
    return [lat, lonN + 2 * Math.PI * Math.floor((Math.PI - lonN) / (2 * Math.PI))];
  }

  class RDNAPTRANS {
    constructor(rdcorr, geoid) { this.rdcorr = rdcorr; this.geoid = geoid; }
    quasiGeoid(lat, lon) { return this.geoid.interp(lat, lon, NaN)[0]; }
    inRdGrid(lat, lon) { return this.rdcorr.inside(lat, lon); }
    etrs89ToRd(lat, lon) {
      let [X, Y, Z] = geodToCart(lat * DEG, lon * DEG, H0_ETRS, A_GRS80, F_GRS80);
      [X, Y, Z] = helmert(X, Y, Z, P_ETRS_RD);
      let [plat, plon] = cartToGeod(X, Y, Z, A_BES, F_BES);
      plat /= DEG; plon /= DEG;
      let la = plat, lo = plon;
      for (let i = 0; i < 50; i++) {
        const [cphi, clam] = this.rdcorr.interp(la, lo, 0);
        const nla = plat - cphi, nlo = plon - clam;
        const done = Math.abs(nla - la) < EPS_DEG && Math.abs(nlo - lo) < EPS_DEG;
        la = nla; lo = nlo;
        if (done) break;
      }
      return besselToRd(la * DEG, lo * DEG);
    }
    etrs89ToRdnap(lat, lon, h) {
      const [x, y] = this.etrs89ToRd(lat, lon);
      return [x, y, h - this.quasiGeoid(lat, lon)];
    }
    rdToEtrs89(x, y) {
      let [blat, blon] = rdToBessel(x, y);
      blat /= DEG; blon /= DEG;
      const [cphi, clam] = this.rdcorr.interp(blat, blon, 0);
      let [X, Y, Z] = geodToCart((blat + cphi) * DEG, (blon + clam) * DEG, H0_BES, A_BES, F_BES);
      [X, Y, Z] = helmert(X, Y, Z, P_RD_ETRS);
      const [lat, lon] = cartToGeod(X, Y, Z, A_GRS80, F_GRS80);
      return [lat / DEG, lon / DEG];
    }
    rdnapToEtrs89(x, y, H) {
      const [lat, lon] = this.rdToEtrs89(x, y);
      return [lat, lon, H + this.quasiGeoid(lat, lon)];
    }
  }
  // puntschaalfactor RD-projectie
  RDNAPTRANS.rdScaleFactor = (x, y) => K_RD * (1 + ((x - X0) ** 2 + (y - Y0) ** 2) / (4 * (K_RD * Rs) ** 2));

  V.Grid = Grid;
  V.RDNAPTRANS = RDNAPTRANS;
})(globalThis.V = globalThis.V || {});
