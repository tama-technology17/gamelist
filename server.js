// Server dev + API. Node 18+, tanpa framework.
//   - menyajikan file statis (dan uploads/)
//   - /api/* meneruskan ke FreeToGame agar tidak terkena CORS
//   - /api/auth/*, /api/me* melayani akun, sesi, dan profil
const http = require('http');
const fs = require('fs');
const path = require('path');
const { users, sessions, sweepSessions, close } = require('./db');
const auth = require('./auth');
const comments = require('./comments');
const votes = require('./votes');

const PORT = Number(process.env.PORT) || 8080;
const UPLOADS = path.join(__dirname, 'uploads');
const MAX_BODY = 64 * 1024; // cukup untuk JSON profil/favorit
const TTL = auth.ACCESS_TTL;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.md': 'text/plain; charset=utf-8',
};

// Modul yang memang dikirim ke browser. server.js/db.js/auth.js/comments.js
// TIDAK boleh masuk sini: semuanya memuat rahasia atau logika internal.
const CLIENT_JS = new Set(['app.js', 'api.js', 'router.js', 'utils.js', 'components.js', 'account.js', 'comment.js', 'vote.js']);

/* ----------------------------- Utilitas ----------------------------- */
const send = (res, status, body, headers = {}) => {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
};
const fail = (res, status, message) => send(res, status, { error: message });
// `status` pada options ditulis terpisah dari headers agar tidak jadi header.
const ok = (res, body = {}, { status = 200, headers } = {}) =>
  send(res, status, body, headers);

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Muatan terlalu besar'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSON(req, limit = MAX_BODY) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    const parsed = JSON.parse(buf.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw Object.assign(new Error('JSON harus berupa objek'), { status: 400 });
    }
    return parsed;
  } catch (err) {
    throw Object.assign(new Error('Body JSON tidak valid.'), { status: 400, cause: err });
  }
}

const clientIP = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  || req.socket.remoteAddress || 'unknown';

/* ------------------------------ Rute auth ---------------------------- */
const routes = [
  ['POST', '/api/auth/register', async (req, res) => {
    const retry = auth.throttle(`reg:${clientIP(req)}`);
    if (retry) return fail(res, 429, `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retry / 60)} menit.`);

    const body = await readJSON(req);
    const u = auth.validateUsername(body.username);
    if (u.error) return fail(res, 400, u.error);
    const p = auth.validatePassword(body.password);
    if (p.error) return fail(res, 400, p.error);
    const prof = auth.validateProfile({ display_name: body.display_name, bio: body.bio });
    if (prof.error) return fail(res, 400, prof.error);

    if (auth.findByUsername(u.value)) return fail(res, 409, 'Username sudah dipakai.');

    const { user } = await auth.createUser({
      username: u.value,
      password: p.value,
      display_name: prof.value.display_name,
      bio: prof.value.bio,
    });
    const { token: refresh, family_id } = auth.createRefreshToken(user);
    return ok(res, { user: auth.publicUser(user), expires_in: auth.ACCESS_TTL },
      { headers: auth.setSessionHeaders(auth.issueAccessToken(user, family_id), refresh) });
  }],

  ['POST', '/api/auth/login', async (req, res) => {
    const body = await readJSON(req);
    const key = `${clientIP(req)}|${String(body.username || '').toLowerCase()}`;
    const retry = auth.throttle(`in:${key}`);
    if (retry) return fail(res, 429, `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retry / 60)} menit.`);

    const u = auth.validateUsername(body.username);
    const user = await auth.checkPassword(u.value || '', body.password);
    if (!user) return fail(res, 401, 'Username atau kata sandi salah.');

    auth.throttleReset(`in:${key}`);
    const { token: refresh, family_id } = auth.createRefreshToken(user);
    return ok(res, { user: auth.publicUser(user), expires_in: auth.ACCESS_TTL },
      { headers: auth.setSessionHeaders(auth.issueAccessToken(user, family_id), refresh) });
  }],

  /**
   * Tukar refresh token dengan access token baru. Setiap pemakaian me-ROTASI
   * refresh token. Bila token yang sudah pernah dirotasi dipakai lagi, itu
   * berarti ada dua pihak yang memegang token sama (indikasi dicuri) dan
   * seluruh rantai rotasi langsung dicabut.
   */
  ['POST', '/api/auth/refresh', (req, res) => {
    const retry = auth.throttle(`rf:${clientIP(req)}`);
    if (retry) return fail(res, 429, 'Terlalu banyak percobaan refresh.');

    const token = auth.readCookies(req)[auth.REFRESH_COOKIE];
    const result = auth.rotateRefreshToken(token);
    if (!result.ok) {
      if (result.reason === 'reused') {
        console.warn('[auth] refresh token dipakai ulang -> seluruh keluarga dicabut');
        return fail(res, 401, 'Sesi tidak aman, silakan masuk lagi.');
      }
      return fail(res, 401, 'Sesi sudah berakhir. Silakan masuk lagi.');
    }
    return ok(res, { user: auth.publicUser(result.user), expires_in: auth.ACCESS_TTL },
      { headers: auth.setSessionHeaders(result.access, result.refresh) });
  }],

  ['POST', '/api/auth/logout', (req, res) => {
    const token = auth.readCookies(req)[auth.REFRESH_COOKIE];
    const row = auth.findRefreshRow(token);
    if (row) auth.revokeFamily(row.family_id);
    return ok(res, { ok: true }, { headers: auth.clearSessionHeaders() });
  }],

  ['GET', '/api/me', (req, res) => {
    const user = auth.userFromRequest(req);
    if (!user) return fail(res, 401, 'Belum masuk.');
    return ok(res, { user: auth.publicUser(user) });
  }],

  ['PATCH', '/api/me', async (req, res, user) => {
    const body = await readJSON(req);
    const prof = auth.validateProfile(body);
    if (prof.error) return fail(res, 400, prof.error);
    Object.assign(user, prof.value);
    users.flush();
    return ok(res, { user: auth.publicUser(user) });
  }],

  // Penggabungan favorit: union based on id, jadi aman dipanggil berulang.
  ['PUT', '/api/me/favorites', async (req, res, user) => {
    const body = await readJSON(req, 512 * 1024);
    const incoming = body.favorites;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return fail(res, 400, 'Format favorites tidak valid.');
    }
    let merged = 0;
    for (const [id, g] of Object.entries(incoming)) {
      if (!/^\d+$/.test(id) || !g || typeof g !== 'object') continue;
      if (!user.favorites[id]) merged++;
      user.favorites[id] = {
        id: Number(id),
        title: String(g.title || '').slice(0, 120),
        thumbnail: String(g.thumbnail || '').slice(0, 600),
        game_url: String(g.game_url || '').slice(0, 600),
        genre: String(g.genre || '').slice(0, 60),
        platform: String(g.platform || '').slice(0, 40),
        publisher: String(g.publisher || '').slice(0, 120),
        developer: String(g.developer || '').slice(0, 120),
        release_date: String(g.release_date || '').slice(0, 40),
      };
    }
    if (merged) users.flush();
    return ok(res, { user: auth.publicUser(user), merged });
  }],

  ['POST', '/api/me/avatar', async (req, res, user) => {
    const buf = await readBody(req, auth.MAX_AVATAR + 1024);
    if (!buf.length) return fail(res, 400, 'Berkas kosong.');

    const kind = auth.sniffImage(buf);
    if (!kind) return fail(res, 415, 'Format tidak didukung. Pakai PNG, JPEG, atau WebP.');
    if (buf.length > auth.MAX_AVATAR) {
      return fail(res, 413, `Ukuran maksimal ${Math.round(auth.MAX_AVATAR / 1024 / 1024)} MB.`);
    }

    fs.mkdirSync(UPLOADS, { recursive: true });
    const name = `u${user.id}-${Date.now().toString(36)}.${kind.ext}`;
    fs.writeFileSync(path.join(UPLOADS, name), buf);

    if (user.avatar) {
      fs.unlink(path.join(UPLOADS, path.basename(user.avatar)), () => {});
    }
    user.avatar = name;
    users.flush();
    return ok(res, { user: auth.publicUser(user) });
  }],

  ['DELETE', '/api/me/avatar', (req, res, user) => {
    if (user.avatar) {
      fs.unlink(path.join(UPLOADS, path.basename(user.avatar)), () => {});
      user.avatar = null;
      users.flush();
    }
    return ok(res, { user: auth.publicUser(user) });
  }],
];

/* ----------------------------- Penilaian ----------------------------- */
// Penilaian game: GET publik, PUT wajib login.
const voteRoutes = [
  ['GET', '/api/votes', (req, res, user) => ok(res, {
    counts: votes.counts(),
    mine: votes.reactionsOf(user),
  })],

  ['PUT', '/api/votes', async (req, res, user) => {
    const body = await readJSON(req, 32 * 1024);
    // Validasi dulu: payload rusak tidak boleh menghabiskan kuota rate limit.
    const v = votes.validateReactions(body);
    if (v.error) return fail(res, 400, v.error);

    const retry = auth.throttle(`vote:${clientIP(req)}|${user.username}`);
    if (retry) return fail(res, 429, `Terlalu banyak penilaian. Coba lagi dalam ${Math.ceil(retry / 60)} menit.`);

    const changed = votes.apply(user, v.value);
    return ok(res, { changed, counts: votes.counts(), mine: votes.reactionsOf(user) });
  }, { auth: true }],
];

routes.push(...voteRoutes);

/* ------------------------------ Komentar ----------------------------- */
// {auth:true} = wajib login. Sisanya boleh anonim.
const commentRoutes = [
  ['GET', '/api/comments', async (req, res, user, { url }) => {
    const gameId = Number(url.searchParams.get('game'));
    if (!Number.isInteger(gameId) || gameId <= 0) return fail(res, 400, 'Parameter game tidak valid.');
    const list = comments.listForGame(gameId);
    return ok(res, {
      comments: list.map((c) => comments.publicComment(c, user)),
      total: list.length,
    });
  }],

  ['POST', '/api/comments', async (req, res, user) => {
    const body = await readJSON(req, 8 * 1024);
    // Validasi DILEWATI dulu: request yang tidak valid tidak boleh menghabiskan
    // kuota rate limit, kalau tidak satu salah ketik sudah mengunci user.
    const v = comments.validateComment(body, { isGuest: !user });
    if (v.error) return fail(res, 400, v.error);

    const retry = auth.throttle(`cmt:${clientIP(req)}|${user ? user.username : 'anon'}`);
    if (retry) return fail(res, 429, `Terlalu banyak komentar. Coba lagi dalam ${Math.ceil(retry / 60)} menit.`);

    const entry = comments.add(v.value, user);
    return ok(res, { comment: comments.publicComment(entry, user) }, { status: 201 });
  }, { auth: false }],

  ['PATCH', '/api/comments/:id', async (req, res, user, { params }) => {
    const entry = comments.find(Number(params.id));
    if (!entry) return fail(res, 404, 'Komentar tidak ditemukan.');
    if (!comments.owns(entry, user)) return fail(res, 403, 'Kamu hanya bisa mengubah komentar sendiri.');
    const v = comments.validateEdit(await readJSON(req, 8 * 1024));
    if (v.error) return fail(res, 400, v.error);
    return ok(res, { comment: comments.publicComment(comments.edit(entry, v.value.text), user) });
  }, { auth: true }],

  ['DELETE', '/api/comments/:id', (req, res, user, { params }) => {
    const entry = comments.find(Number(params.id));
    if (!entry) return fail(res, 404, 'Komentar tidak ditemukan.');
    if (!comments.owns(entry, user)) return fail(res, 403, 'Kamu hanya bisa menghapus komentar sendiri.');
    comments.remove(entry);
    return ok(res, { ok: true, id: entry.id });
  }, { auth: true }],

  ['POST', '/api/comments/:id/like', (req, res, user, { params }) => {
    const entry = comments.find(Number(params.id));
    if (!entry) return fail(res, 404, 'Komentar tidak ditemukan.');
    const liked = comments.toggleLike(entry, user.username);
    return ok(res, { id: entry.id, liked, likes: entry.likes.length });
  }, { auth: true }],
];

routes.push(...commentRoutes);

// Kompilasi pola: "/api/comments/:id" -> regex dengan parameter bernama.
function compile(pattern) {
  const keys = [];
  const rx = new RegExp(`^${pattern.replace(/:([A-Za-z_]\w*)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  return { rx, keys };
}
const compiled = routes.map(([method, path, handler, opts = {}]) => ({
  method, path, handler, needsAuth: !!opts.auth, ...compile(path),
}));

function matchRoute(method, pathname) {
  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = r.rx.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { handler: r.handler, needsAuth: r.needsAuth, params };
  }
  return null;
}

/* ------------------------------- Server ------------------------------ */
fs.mkdirSync(UPLOADS, { recursive: true });
sweepSessions();
setInterval(sweepSessions, 60 * 60 * 1000).unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { close(); process.exit(0); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  try {
    /* 1. API internal (akun + komentar) */
    const hit = matchRoute(req.method, pathname);
    if (hit) {
      const user = auth.userFromRequest(req);
      // /api/me* dan endpoint ber-{auth:true} wajib punya sesi valid.
      const protectedRoute = hit.needsAuth || pathname.startsWith('/api/me');
      if (protectedRoute && !user) return fail(res, 401, 'Belum masuk.');
      return await hit.handler(req, res, user, { params: hit.params, url });
    }
    // Jalur milik kita yang tidak terdaftar harus 404 JSON, bukan diteruskan.
    if (pathname.startsWith('/api/me') || pathname.startsWith('/api/comments') || pathname.startsWith('/api/votes')) {
      return fail(res, 404, 'Endpoint tidak ditemukan.');
    }

    /* 2. Upload avatar */
    if (pathname.startsWith('/uploads/')) {
      const file = path.join(UPLOADS, path.basename(decodeURIComponent(pathname)));
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(file).pipe(res);
    }

    /* 3. Proxy ke FreeToGame (menghindari CORS).
       Hanya dua endpoint yang di-proxy, supaya /api/* lain tidak ikut
       diteruskan ke situs pihak ketiga. */
    if (pathname === '/api/games' || pathname === '/api/game') {
      try {
        const upstream = await fetch(`https://www.freetogame.com${pathname}${url.search}`);
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(buf);
      } catch {
        res.writeHead(502);
        return res.end('{}');
      }
    }
    if (pathname.startsWith('/api/')) return fail(res, 404, 'Endpoint tidak ditemukan.');

    /* 4. Statis */
    const rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.join(__dirname, path.normalize(rel));
    if (file !== __dirname && !file.startsWith(__dirname + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    // Hanya empat ekstensi berikut yang boleh disajikan. Sengaja TIDAK ada
    // .json: client tidak pernah requesting berkas JSON, jadi ini mencegah
    // data/users.json & data/sessions.json ikut bocor lewat server statis.
    if (!['.html', '.css', '.js', '.md'].includes(path.extname(file).toLowerCase())) {
      res.writeHead(404);
      return res.end('Not found');
    }
    // Allowlist, bukan denylist: berkas .js baru otomatis tertolak sampai
    // sengaja didaftarkan. Ini yang melindungi db.js / auth.js / comments.js
    // yang berisi hash password dan token sesi.
    if (path.extname(file).toLowerCase() === '.js' && !CLIENT_JS.has(path.basename(file))) {
      res.writeHead(404);
      return res.end('Not found');
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[server]', err);
    if (!res.headersSent) fail(res, status, status >= 500 ? 'Terjadi kesalahan di server.' : err.message);
    else res.end();
  }
}).listen(PORT, () => {
  console.log(`GameList: buka http://localhost:${PORT}/?api=/api`);
  console.log(`Data: data/ | Avatar: uploads/ | ${users.data.users.length} akun, ${sessions.data.sessions.length} sesi`);
});