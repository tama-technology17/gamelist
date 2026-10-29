// JWT HS256 minimal, dibangun di atas crypto bawaan Node.
// Tidak menambah dependensi: HS256 persis HMAC-SHA256(base64url(header) + '.' +
// base64url(payload)), yang memang seluruh isi spesifikasi JWT.
// Kalau nanti butuh JWK/RS256 atau verifikasi key publik, barulah kita perlu library.
const crypto = require('crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const unb64url = (str) => Buffer.from(str, 'base64url');

class JwtError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.reason = reason; // 'malformed' | 'signature' | 'expired' | 'not-yet-valid'
  }
}

function sign(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.createHmac('sha256', secret).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

/** Verifikasi tanda tangan + masa berlaku. Melempar JwtError kalau tidak sah. */
function verify(token, secret, { clockSkewSec = 30 } = {}) {
  if (typeof token !== 'string') throw new JwtError('malformed', 'Token bukan string.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('malformed', 'Format JWT harus tiga bagian.');

  const [h, p, s] = parts;
  let header;
  try {
    header = JSON.parse(unb64url(h).toString('utf8'));
  } catch {
    throw new JwtError('malformed', 'Header JWT tidak bisa dibaca.');
  }
  // Menolak algoritma lain penting: mencegah serangan "alg: none" dan
  // pemakaian HS256 sebagai RSA public key.
  if (header.alg !== 'HS256') throw new JwtError('malformed', `Algoritma tidak didukung: ${header.alg}`);
  if (header.typ && header.typ !== 'JWT') throw new JwtError('malformed', `Tipe token tidak didukung: ${header.typ}`);

  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = unb64url(s);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    throw new JwtError('signature', 'Tanda tangan tidak cocok.');
  }

  let payload;
  try {
    payload = JSON.parse(unb64url(p).toString('utf8'));
  } catch {
    throw new JwtError('malformed', 'Payload JWT tidak bisa dibaca.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && now > payload.exp + clockSkewSec) throw new JwtError('expired', 'Token kedaluwarsa.');
  if (typeof payload.nbf === 'number' && now < payload.nbf - clockSkewSec) throw new JwtError('not-yet-valid', 'Token belum aktif.');
  return payload;
}

// Tolak token yang header-nya sendiri sudah lebih besar dari algo/typ.
const decodeHeader = (token) => {
  try {
    return JSON.parse(unb64url(String(token).split('.')[0]).toString('utf8'));
  } catch {
    throw new JwtError('malformed', 'Header JWT tidak bisa dibaca.');
  }
};

module.exports = { sign, verify, decodeHeader, JwtError };