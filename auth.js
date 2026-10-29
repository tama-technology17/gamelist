// Logika akun: hash password, access token JWT, refresh token berotasi,
// cookie, validasi, dan pembatasan brute force.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('./jwt');
const { users, sessions } = require('./db');

const BCRYPT_ROUNDS = 12;
const ACCESS_TTL = Number(process.env.ACCESS_TTL_SEC) || 15 * 60; // 15 menit
const REFRESH_TTL = Number(process.env.REFRESH_TTL_SEC) || 30 * 24 * 60 * 60; // 30 hari
const MAX_AVATAR = 2 * 1024 * 1024; // 2 MB
const BIO_MAX = 280;
const NAME_MAX = 40;

const ACCESS_COOKIE = 'gl_at';
const REFRESH_COOKIE = 'gl_rt';
// Refresh cookie hanya dikirim ke /api/auth, jadi tidak ikut ke setiap request API.
const REFRESH_PATH = '/api/auth';

/* ----------------------------- Validasi ----------------------------- */
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

function validateUsername(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(s)) return { error: 'Username harus 3-20 karakter, hanya huruf, angka, dan garis bawah.' };
  return { value: s };
}

function validatePassword(v) {
  const s = String(v ?? '');
  if (s.length < 8) return { error: 'Kata sandi minimal 8 karakter.' };
  if (s.length > 200) return { error: 'Kata sandi terlalu panjang.' };
  return { value: s };
}

function validateProfile(body) {
  const out = {};
  if (body.display_name !== undefined) {
    const s = String(body.display_name).trim();
    if (s.length > NAME_MAX) return { error: `Nama tampilan maksimal ${NAME_MAX} karakter.` };
    out.display_name = s;
  }
  if (body.bio !== undefined) {
    const s = String(body.bio).trim();
    if (s.length > BIO_MAX) return { error: `Bio maksimal ${BIO_MAX} karakter.` };
    out.bio = s;
  }
  return { value: out };
}

/* ------------------------------- User ------------------------------- */
const findByUsername = (name) => users.data.users.find((u) => u.username === name) || null;
const findById = (id) => users.data.users.find((u) => u.id === id) || null;

async function createUser({ username, password, display_name, bio }) {
  if (findByUsername(username)) return { error: 'Username sudah dipakai.' };
  const user = {
    id: users.data.nextId++,
    username,
    password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    display_name: display_name || username,
    bio: bio || '',
    avatar: null, // nama file di uploads/, bukan URL
    favorites: {}, // id (string) -> ringkasan game
    created_at: Date.now(),
  };
  users.data.users.push(user);
  users.flush();
  return { user };
}

// Selalu timing-konstan: cek user palsu bila username tidak ada, agar tidak
// bisa dipakai menebak username mana yang terdaftar.
const DUMMY_HASH = bcrypt.hashSync('::tidak-ada-user-dengan-nama-ini::', BCRYPT_ROUNDS);

async function checkPassword(username, password) {
  const user = findByUsername(username);
  const hash = user ? user.password_hash : DUMMY_HASH;
  const ok = await bcrypt.compare(String(password ?? ''), hash);
  return ok && user ? user : null;
}

/* ------------------------------ Rahasia JWT ------------------------------ */
// Secret harus stabil antar restart, kalau tidak semua access token mati tiap
// kali server di-restart. Disimpan di data/secret.key (0600), bukan di repo.
const SECRET_FILE = path.join(__dirname, 'data', 'secret.key');

function loadSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return { secret: fromEnv, source: 'JWT_SECRET' };
  if (fromEnv) console.warn('[auth] JWT_SECRET terlalu pendek (min 32 karakter), mengabaikan.');
  try {
    const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (saved.length >= 32) return { secret: saved, source: SECRET_FILE };
  } catch { /* belum ada, dibuat di bawah */ }
  const generated = crypto.randomBytes(48).toString('base64url');
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  console.log(`[auth] JWT secret dibuat di ${SECRET_FILE} (mode 0600). Jangan commit berkas ini.`);
  return { secret: generated, source: SECRET_FILE };
}

const { secret: JWT_SECRET, source: SECRET_SOURCE } = loadSecret();

/* ------------------------------- Sesi -------------------------------- */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Terbitkan access token JWT singkat untuk user.
 * `typ` dan `jti` sengaja ada supaya token access tidak pernah bisa dipakai
 * di tempat refresh token atau sebaliknya.
 * `fid` (family id) ikut ditanam supaya logout bisa langsung membatalkan
 * token access ini tanpa menunggu kedaluwarsa.
 */
function issueAccessToken(user, familyId) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    typ: 'access',
    sub: user.id,
    uname: user.username,
    fid: familyId,
    iat: now,
    nbf: now,
    exp: now + ACCESS_TTL,
    jti: crypto.randomUUID(),
  }, JWT_SECRET);
}

/**
 * Buat refresh token opaque + catat hash-nya di database.
 * Family = satu rantai rotasi; dipakai untuk mencabut semua token bila
 * terjadi penyalahgunaan (reuse detection).
 */
function createRefreshToken(user, familyId) {
  const token = crypto.randomBytes(48).toString('base64url');
  const family = familyId || crypto.randomUUID();
  const row = {
    id: sessions.data.nextId++,
    user_id: user.id,
    token_hash: hashToken(token),
    family_id: family,
    created_at: Date.now(),
    expires: Date.now() + REFRESH_TTL * 1000,
    rotated_at: null,
    revoked_at: null,
    replaced_by: null,
  };
  sessions.data.sessions.push(row);
  sessions.flush();
  return { token, family_id: family, row };
}

const findRefreshRow = (token) => {
  if (!token) return null;
  const h = hashToken(token);
  return sessions.data.sessions.find((s) => s.token_hash === h) || null;
};

// Mel思维能力 seluruh rantai rotasi dicabut bila ada token lama dipakai lagi.
function revokeFamily(familyId) {
  const now = Date.now();
  let n = 0;
  for (const s of sessions.data.sessions) {
    if (s.family_id === familyId && !s.revoked_at) { s.revoked_at = now; n++; }
  }
  if (n) sessions.flush();
  return n;
}

function revokeAllForUser(userId) {
  const now = Date.now();
  let n = 0;
  for (const s of sessions.data.sessions) {
    if (s.user_id === userId && !s.revoked_at) { s.revoked_at = now; n++; }
  }
  if (n) sessions.flush();
  return n;
}

/**
 * Tukar refresh token dengan access token baru (rotasi).
 * Mengembalikan { ok:false, reason } atau { ok:true, ... }.
 *  - 'invalid'  : token tidak dikenal
 *  - 'expired'  : kedaluwarsa
 *  - 'reused'   : token yang SUDAH dirotasi dipakai lagi -> curiga dicuri,
 *                  seluruh keluarga dicabut
 */
function rotateRefreshToken(token) {
  const row = findRefreshRow(token);
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.revoked_at) {
    revokeFamily(row.family_id);
    return { ok: false, reason: 'reused' };
  }
  if (row.expires <= Date.now()) {
    revokeFamily(row.family_id);
    return { ok: false, reason: 'expired' };
  }
  const user = findById(row.user_id);
  if (!user) return { ok: false, reason: 'invalid' };

  const next = createRefreshToken(user, row.family_id);
  row.rotated_at = Date.now();
  row.revoked_at = Date.now();
  row.replaced_by = next.row.id;
  sessions.flush();
  return { ok: true, user, access: issueAccessToken(user, row.family_id), refresh: next.token };
}

// Apakah rantai rotasi ini masih hidup? Satu baris yang belum dicabut cukup.
const isFamilyLive = (familyId) => {
  if (!familyId) return true; // tanpa fid, signature JWT saja yang menentukan
  return sessions.data.sessions.some((s) => s.family_id === familyId && !s.revoked_at);
};

/* ------------------------ Autentikasi request ------------------------ */
// Token JWT adalah stateless, jadi signature yang sah saja tidak cukup untuk
// menentukan "masih login". Claim `fid` membuat logout berlaku seketika:
// begitu rantai rotasi dicabut, access token-nya langsung ditolak tanpa
// harus menunggu 15 menit sampai kedaluwarsa.
function userFromRequest(req) {
  const token = readCookies(req)[ACCESS_COOKIE];
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
  if (payload.typ !== 'access') return null;
  if (!isFamilyLive(payload.fid)) return null;
  // Identitas diambil ulang dari DB supaya akun yang dihapus/diubah langsung berlaku.
  return findById(payload.sub) || null;
}

/* ------------------------------- Cookie ------------------------------- */
const baseCookie = (name, value, maxAge, path = '/') =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;

const accessCookie = (token) => baseCookie(ACCESS_COOKIE, token, ACCESS_TTL);
const refreshCookie = (token) => baseCookie(REFRESH_COOKIE, token, REFRESH_TTL, REFRESH_PATH);
const clearAccessCookie = () => baseCookie(ACCESS_COOKIE, '', 0);
const clearRefreshCookie = () => baseCookie(REFRESH_COOKIE, '', 0, REFRESH_PATH);

const setSessionCookies = (res, access, refresh) => {
  res.setHeader('Set-Cookie', [accessCookie(access), refreshCookie(refresh)]);
};
const clearSessionCookies = (res) => {
  res.setHeader('Set-Cookie', [clearAccessCookie(), clearRefreshCookie()]);
};

// Bentuk yang dipakai server.js: Set-Cookie sebagai array header.
const setSessionHeaders = (access, refresh) => {
  const out = {};
  out['Set-Cookie'] = [accessCookie(access), refreshCookie(refresh)];
  return out;
};
const clearSessionHeaders = () => ({ 'Set-Cookie': [clearAccessCookie(), clearRefreshCookie()] });

/* ---------------------- Pembatasan percobaan ------------------------ */
// Diatur lewat env supaya mudah dilonggarkan untuk dev/test di IP yang sama.
const WINDOW = Number(process.env.AUTH_WINDOW_MS) || 15 * 60 * 1000;
const MAX_ATTEMPTS = Number(process.env.AUTH_MAX_ATTEMPTS) || 8;
const attempts = new Map(); // kunci -> { count, resetAt }

function throttle(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW });
    return null;
  }
  // Jangan hitung request yang sudah pasti ditolak (mis. rate limit penuh);
  // kalau tidak, satu burst panjang bisa menutup jendela untuk waktu yang jauh
  // lebih lama dari yang dimaksud.
  if (rec.count >= MAX_ATTEMPTS) return Math.ceil((rec.resetAt - now) / 1000);
  rec.count++;
  return null;
}
const throttleReset = (key) => attempts.delete(key);
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of attempts) if (r.resetAt <= now) attempts.delete(k);
}, WINDOW).unref();

/* ----------------------------- Avatar -------------------------------- */
// Deteksi lewat magic bytes, bukan Content-Type yangdikirim browser.
const SIGNATURES = [
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'webp', mime: 'image/webp',
    test: (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

const sniffImage = (buf) => SIGNATURES.find((s) => s.test(buf)) || null;

/* ---------------------------- Serialisasi ---------------------------- */
// Field yang boleh dikirim ke klien. Jangan pernah kirim password_hash.
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name || u.username,
    bio: u.bio || '',
    avatar_url: u.avatar ? `/uploads/${u.avatar}` : null,
    favorites: u.favorites || {},
    created_at: u.created_at,
  };
}

module.exports = {
  ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_PATH,
  ACCESS_TTL, REFRESH_TTL, MAX_AVATAR, BIO_MAX, NAME_MAX,
  JWT_SECRET, SECRET_SOURCE,
  validateUsername, validatePassword, validateProfile,
  findByUsername, findById, createUser, checkPassword,
  issueAccessToken, createRefreshToken, rotateRefreshToken,
  findRefreshRow, revokeFamily, revokeAllForUser, hashToken,
  userFromRequest, readCookies,
  setSessionCookies, clearSessionCookies, setSessionHeaders, clearSessionHeaders,
  accessCookie, refreshCookie, clearAccessCookie, clearRefreshCookie,
  throttle, throttleReset,
  sniffImage, publicUser,
};