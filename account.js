// KlienAkun: seluruh komunikasi ke /api/auth/* dan /api/me*.
// Sengaja memakai path ABSOLUT (same-origin) dan bukan BASE dari api.js:
// BASE bisa diarahkan ke FreeToGame atau lewat ?api=, sedangkan endpoint
// akun hanya hidup di server ini. Menggabungkan keduanya tidak akan pernah benar.
//
// Token access (JWT berumur pendek) dikirim lewat cookie httpOnly, jadi JS
// tidak pernah menyentuhnya. Saat endpoint lain membalas 401 karena access
// token kedaluwarsa, klien otomatis menukar refresh token satu kali lalu
// mengulang request aslinya.
// membalas 401 karena access token kedaluwarsa, klien otomatis menukar
// refresh token satu kali lalu mengulang request aslinya.

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const isUnauthenticated = (err) => err instanceof AuthError && err.status === 401;

const NO_SERVER_HINT = 'Server ini tidak melayani API akun. Jalankan `node server.js` (bukan python -m http.server) agar fitur masuk, profil, dan sinkronisasi favorit tersedia.';

// Cegah refresh ganda saat beberapa request 401 bersamaan (mis. setelah reload).
let refreshing = null;

/**
 * Satu kali tukar refresh token, dipakai bersama oleh semua request yang
 * mencionar 401 bersamaan.
 */
async function refreshOnce() {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
        if (!res.ok) throw new AuthError(res.status, 'refresh gagal');
        return await res.json();
      } finally {
        // Beri chance ke pemanggil berikutnya di tick yang sama untuk ikut
        // memakai hasil yang sama, baru bersihkan untuk request berikutnya.
        setTimeout(() => { refreshing = null; }, 0);
      }
    })();
  }
  return refreshing;
}

async function rawCall(path, { method = 'GET', body, headers, raw } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: raw ? headers : (body !== undefined ? { 'Content-Type': 'application/json' } : headers),
    body: raw ? body : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  return res;
}

function toError(res, data) {
  if (res.status === 404) return new AuthError(404, NO_SERVER_HINT);
  return new AuthError(res.status, data?.error || `Permintaan gagal (status ${res.status}).`);
}

/**
 * Panggil endpoint internal. Kalau 401 (access token kedaluwarsa), coba satu
 * kali tukar refresh token lalu ulangi request. `allowRefresh:false` untuk
 * endpoint yang memang butuh kredensial dan tidak boleh dicoba ulang.
 */
export async function call(path, options = {}) {
  const { allowRefresh = true } = options;
  // Login/register/logout/refresh tidak boleh memicu refresh otomatis:
  // bisa.loop, dan tanpa itu 401 yang asli ikut tertutup.
  const guarded = /^\/api\/auth\/(login|register|refresh|logout)$/.test(path);
  const mayRefresh = allowRefresh && !guarded;
  let res;
  try {
    res = await rawCall(path, options);
  } catch {
    throw new AuthError(0, 'Tidak dapat menghubungi server. Pastikan `node server.js` sedang berjalan.');
  }

  if (res.status === 401 && mayRefresh) {
    // Buang body supaya tidak ada stream yang menggantung.
    await res.text().catch(() => {});
    try {
      await refreshOnce();
    } catch {
      throw new AuthError(401, 'Sesi berakhir. Silakan masuk lagi.');
    }
    // Ulangi request aslinya dengan cookie access yang baru.
    try {
      res = await rawCall(path, options);
    } catch {
      throw new AuthError(0, 'Tidak dapat menghubungi server. Pastikan `node server.js` sedang berjalan.');
    }
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw toError(res, data);
  return data;
}

// Dipakai comment.js & vote.js: akses ke throw AuthError yang sama.
export const parseOrThrow = async (res) => {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw toError(res, data);
  return data;
};

// Untuk kasus di mana klien perlu memicu refresh manual (mis. setelah lama
// tidak aktif lalu kembali ke tab).
export const refreshSession = refreshOnce;

// Batas harus sama dengan auth.js MAX_AVATAR; dicek lagi di server.
export const MAX_AVATAR = 2 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const checkAvatar = (file) => {
  if (!file) return 'Pilih berkas dulu.';
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Format harus PNG, JPEG, atau WebP.';
  if (file.size > MAX_AVATAR) return `Ukuran maksimal ${Math.round(MAX_AVATAR / 1024 / 1024)} MB.`;
  return null;
};

export const api = {
  me: () => call('/api/me'),
  login: (username, password) => call('/api/auth/login', { method: 'POST', body: { username, password } }),
  register: (payload) => call('/api/auth/register', { method: 'POST', body: payload }),
  logout: () => call('/api/auth/logout', { method: 'POST' }),
  updateProfile: (patch) => call('/api/me', { method: 'PATCH', body: patch }),
  pushFavorites: (favorites) => call('/api/me/favorites', { method: 'PUT', body: { favorites } }),
  removeAvatar: () => call('/api/me/avatar', { method: 'DELETE' }),

  // Avatar dikirim sebagai byte mentah, bukan multipart atau base64:
  // hemat ~33% dan server tinggal menulis buffer apa adanya.
  uploadAvatar: (file) => call('/api/me/avatar', {
    method: 'POST',
    raw: true,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  }),
};