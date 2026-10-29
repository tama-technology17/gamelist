// Inisialisasi aplikasi, state, dan render halaman.
import { getGames, getGame, TAGS } from './api.js';
import { initRouter, parseHash, buildHash, navigate, setParams } from './router.js';
import { h, debounce, store, icon, KEY_THEME } from './utils.js';
import * as ui from './components.js';
import * as account from './account.js';
import * as comment from './comment.js';
import * as vote from './vote.js';

ui.setAvatarValidator(account.checkAvatar);

const KEY_FAV = 'gamelist:favorites';
const KEY_RECENT = 'gamelist:recent';
const KEY_RETURN = 'gamelist:return';
const PAGE = 24;
const PLATFORMS = [['', 'Semua platform'], ['windows', 'PC (Windows)'], ['browser', 'Browser']];
// 'rating' disortir di klien memakai data suara, bukan parameter API.
const SORTS = [['popularity', 'Terpopuler'], ['release-date', 'Terbaru'], ['alphabetical', 'A-Z'], ['relevance', 'Relevansi'], ['rating', 'Rating tertinggi']];
const SORTS_SHORT = { popularity: 'Terpopuler', 'release-date': 'Terbaru', alphabetical: 'A-Z', relevance: 'Relevansi', rating: 'Rating tertinggi' };
const SUMMARY = ['id', 'title', 'thumbnail', 'short_description', 'game_url', 'genre', 'platform', 'publisher', 'developer', 'release_date', 'freetogame_profile_url'];

const view = document.getElementById('view');
const menu = document.getElementById('menu');
const burger = document.getElementById('burger');
const topBtn = document.getElementById('to-top');
const nav = document.getElementById('nav');
const progress = document.getElementById('progress');
const themeBtn = document.getElementById('theme');

const known = new Map(); // id -> data game yang pernah dimuat
let favs = store.get(KEY_FAV, []);
if (!Array.isArray(favs)) favs = [];
let requestId = 0;
let featuredId = null;

/* ---------- Akun ---------- */
let user = null;          // objek user dari server, atau null
let userKnown = false;    // sudah selesai cek sesi (beda dari "tidak masuk")
let lastActiveAt = Date.now();

const toMap = (list) => Object.fromEntries((list || []).map((g) => [g.id, summary(g)]));
const favoritesOf = (u) => Object.values(u?.favorites || {});

async function refreshUser() {
  try {
    // call() sudah otomatis menukar refresh token bila access token basi.
    const res = await account.api.me();
    setUser(res.user);
    await migrateFavorites();
  } catch (err) {
    if (account.isUnauthenticated(err)) setUser(null);
    else console.warn('[akun]', err.message);
  } finally {
    userKnown = true;
    paintAccountNav();
  }
}

function setUser(next) {
  user = next;
  // Sumber kebenaran favorit berpindah ke server begitu ada sesi.
  if (user) favs = favoritesOf(user);
  else favs = store.get(KEY_FAV, []) || [];
  if (!Array.isArray(favs)) favs = [];
  favs.sort((a, b) => Number(a.id) - Number(b.id));
  store.set(KEY_FAV, favs);
  updateBadge();
}

// Favorit lokal yang belum pernah tersinkron dikirim sekali setelah login.
let migrating = false;
async function migrateFavorites() {
  if (!user || migrating) return;
  const local = store.get(KEY_FAV, []) || [];
  const missing = Object.values(toMap(local)).filter((g) => !user.favorites[g.id]);
  if (!missing.length) return;
  migrating = true;
  try {
    const res = await account.api.pushFavorites(toMap(local));
    setUser(res.user);
    ui.toast(`${missing.length} favorit tersinkron ke akun`, 'refresh');
  } catch (err) {
    console.warn('[akun] sinkronisasi gagal:', err.message);
  } finally {
    migrating = false;
  }
}

// Dorong perubahan favorit ke server (fire-and-forget; lokal tetap jalan).
const pushFavorites = debounce(async () => {
  if (!user) return;
  try {
    const res = await account.api.pushFavorites(toMap(favs));
    if (res?.user) user = res.user;
  } catch (err) {
    if (account.isUnauthenticated(err)) { setUser(null); paintAccountNav(); }
    else ui.toast('Favorit belum tersimpan ke server', 'refresh');
  }
}, 800);

function paintAccountNav() {
  const slot = document.getElementById('account-nav');
  if (!slot) return;
  slot.replaceChildren();
  if (user) {
    const name = user.display_name || user.username;
    const face = user.avatar_url
      ? h('img', { class: 'avatar-nav', src: `${user.avatar_url}?v=${user.created_at || 0}`, alt: '' })
      : h('span', { class: 'avatar-nav fallback' }, name[0].toUpperCase());
    slot.append(h('a', { class: 'account-chip', href: '#/profil', title: `@${user.username}`, 'data-route': 'profile' },
      face, h('span', { class: 'account-name', text: name })));
  } else {
    slot.append(
      h('a', { class: 'account-link', href: '#/masuk', 'data-route': 'masuk', text: 'Masuk' }),
      h('a', { class: 'btn primary account-cta', href: '#/daftar', 'data-route': 'daftar', text: 'Daftar' }));
  }
}

const isFav = (id) => favs.some((g) => g.id === id);
const remember = (list) => list.forEach((g) => known.set(g.id, { ...known.get(g.id), ...g }));
const summary = (g) => Object.fromEntries(SUMMARY.map((k) => [k, g[k]]));
const reload = () => route(parseHash());

/* ---------- Tema ---------- */
const prefersLight = () => matchMedia('(prefers-color-scheme: light)').matches;
const currentTheme = () => document.documentElement.dataset.theme || (prefersLight() ? 'light' : 'dark');
function paintTheme() {
  const light = currentTheme() === 'light';
  themeBtn.replaceChildren(icon(light ? 'moon' : 'sun'));
  themeBtn.setAttribute('aria-label', light ? 'Aktifkan mode gelap' : 'Aktifkan mode terang');
  themeBtn.title = themeBtn.getAttribute('aria-label');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', light ? '#f7f6fc' : '#0c0a1a');
}
function toggleTheme() {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  store.set(KEY_THEME, next);
  paintTheme();
}
paintTheme();

/* ---------- Reveal + intro bertahap ---------- */
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let observer = null;
if ('IntersectionObserver' in window && !reduced) {
  document.documentElement.classList.add('reveal');
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      observer.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -60px' });
}
const reveal = (root) => root?.querySelectorAll('.card:not(.in), .sec:not(.in)').forEach((el) => observer?.observe(el));

// Naikkan isi halaman berurutan. Hero punya animasi sendiri (CSS), jadi dilewati.
let introTimer;
function stage() {
  const fresh = document.documentElement.dataset.intro === '1';
  clearTimeout(introTimer);
  view.classList.remove('intro');
  [...view.children].forEach((el, i) => {
    if (!el.classList.contains('hero')) el.style.setProperty('--d', `${(fresh ? 340 : 0) + i * 70}ms`);
  });
  view.classList.add('intro');
  introTimer = setTimeout(() => view.classList.remove('intro'), 1200);
}

/* ---------- Scroll: progress, tombol atas, parallax hero ---------- */
let queued = false;
function paintScroll() {
  queued = false;
  const max = document.documentElement.scrollHeight - innerHeight;
  progress.style.width = `${max > 0 ? Math.min(100, (scrollY / max) * 100) : 0}%`;
  nav.classList.toggle('stuck', scrollY > 8);
  topBtn.hidden = scrollY < 600;
  if (reduced) return;

  const hero = view.querySelector('.hero');
  if (!hero) return;
  const span = hero.offsetHeight || 1;
  const p = Math.min(1, scrollY / span);
  const media = hero.querySelector('.hero-media');
  if (media) media.style.transform = `translate3d(0,${(p * span * 0.24).toFixed(1)}px,0) scale(${(1 + p * 0.07).toFixed(3)})`;
  hero.style.setProperty('--ho', Math.max(0, 1 - p * 0.95).toFixed(3));
}
const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(paintScroll); } };
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll, { passive: true });
onScroll();

/* Tampilkan skeleton, jalankan task, render hasil; jika gagal tampilkan error + Retry. */
async function guarded(skeleton, task, render) {
  const id = ++requestId;
  view.replaceChildren(skeleton);
  try {
    const data = await task();
    if (id === requestId) render(data);
  } catch (err) {
    if (id === requestId) view.replaceChildren(ui.errorState(err, () => guarded(skeleton, task, render)));
  }
}

/* ---------- Home ---------- */
const renderHome = () => guarded(ui.skeletonHome(), async () => {
  const [popular, newest] = await Promise.all([getGames({ sort: 'popularity' }), getGames({ sort: 'release-date' })]);
  if (!popular.length) return null;
  remember(popular);
  remember(newest);
  const featured = popular.find((g) => g.id === featuredId) || popular[Math.floor(Math.random() * Math.min(10, popular.length))];
  featuredId = featured.id;
  let image = featured.thumbnail;
  try {
    image = (await getGame(featured.id)).screenshots?.[0]?.image || image;
  } catch { /* pakai thumbnail */ }
  return { popular, newest, featured, image };
}, (d) => {
  if (!d) {
    view.replaceChildren(ui.stateBox('Belum ada game', 'API mengembalikan daftar kosong.', 'inbox', h('button', { class: 'btn primary', type: 'button', onclick: reload }, 'Coba lagi')));
    stage();
    return;
  }
  const counts = new Map();
  d.popular.forEach((g) => counts.set(g.genre, (counts.get(g.genre) || 0) + 1));
  const chips = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([name, n]) => h('a', { class: 'chip', href: buildHash('/games', { genre: name }) }, name, h('b', { text: String(n) })));
  const popular = ui.grid(d.popular.slice(0, 8), isFav, voteOpts());
  const newest = ui.grid(d.newest.slice(0, 8), isFav, voteOpts());
  view.replaceChildren(
    ui.hero(d.featured, d.image),
    ui.section('Kategori', 'Semua game', '#/games', h('div', { class: 'chips' }, chips)),
    ui.section('Game populer', 'Lihat semua', '#/games', popular),
    ui.section('Rilis terbaru', 'Lihat semua', '#/games?sort=release-date', newest));
  reveal(view);
  stage();
  onScroll();
});

/* ---------- Katalog ---------- */
function renderCatalog(p) {
  const s = { q: p.q || '', platform: p.platform || '', category: p.category || '', genre: p.genre || '', sort: p.sort || 'popularity', shown: PAGE };
  let games = [];

  const results = h('div');
  const count = h('p', { class: 'count', role: 'status', 'aria-live': 'polite' });
  const more = h('button', { class: 'btn', type: 'button', onclick: () => { s.shown += PAGE; paint(); } }, 'Muat lebih banyak');
  const recents = h('div', { class: 'chips', 'aria-label': 'Pencarian terakhir' });
  const active = h('div', { class: 'active' });
  const genreSel = h('select', { name: 'genre', 'aria-label': 'Genre' });
  const search = h('div', { class: 'search' });
  const clearBtn = h('button', { class: 'clear', type: 'button', hidden: true, 'aria-label': 'Bersihkan pencarian', onclick: () => { input.value = ''; runQuery(''); } }, icon('x'));
  const kbd = h('kbd', { text: '/', 'aria-hidden': 'true' });
  const selects = {};
  const filterPanel = h('div', { class: 'filters' });

  const sync = () => setParams('/games', { q: s.q, platform: s.platform, category: s.category, genre: s.genre, sort: s.sort === 'popularity' ? '' : s.sort });
  // Reset hanya filter; riwayat pencarian punya tombol "Hapus riwayat" sendiri.
  const reset = () => navigate('/games');

  const saveRecent = (text) => {
    const t = text.trim();
    if (t.length < 2) return;
    store.set(KEY_RECENT, [t, ...store.get(KEY_RECENT, []).filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6));
    drawRecents();
  };
  const runQuery = (text) => { s.q = text.trim(); s.shown = PAGE; sync(); paint(); };
  const useQuery = (t) => { input.value = t; runQuery(t); input.focus(); };
  function drawRecents() {
    const list = store.get(KEY_RECENT, []);
    const items = list.map((t) => h('button', { class: 'chip', type: 'button', onclick: () => useQuery(t) }, t));
    if (list.length) items.push(h('button', { class: 'chip', type: 'button', onclick: () => { store.set(KEY_RECENT, []); drawRecents(); } }, 'Hapus riwayat'));
    recents.replaceChildren(...items);
  }

  const input = h('input', {
    type: 'search', placeholder: 'Cari judul game…', value: s.q, autocomplete: 'off',
    'aria-label': 'Cari judul game',
    onkeydown: (e) => { if (e.key === 'Enter') saveRecent(input.value); },
  });
  const onQuery = debounce(() => runQuery(input.value));
  input.addEventListener('input', onQuery);
  search.append(icon('search'), input, clearBtn, kbd);

  // Filter server-side (platform, kategori, sort): ambil ulang data (di-cache oleh api.js)
  const field = (label, name, options) => {
    const sel = h('select', { name, 'aria-label': label }, options.map(([v, t]) => h('option', { value: v, text: t })));
    sel.value = s[name];
    sel.addEventListener('change', () => { s[name] = sel.value; s.shown = PAGE; sync(); refresh(); });
    selects[name] = sel;
    return h('label', {}, label, sel);
  };

  // Sort sebagai segmented control (lebih cepat diklik daripada <select>)
  const segBtns = SORTS.map(([v, t]) => h('button', {
    class: 'seg-btn', type: 'button', 'aria-pressed': String(s.sort === v),
    onclick: () => {
      s.sort = v; s.shown = PAGE;
      segBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SORTS[i][0] === v)));
      sync(); refresh();
    },
  }, t));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Urutkan' }, segBtns);

  // Genre: filter lokal dari data yang sudah dimuat
  genreSel.addEventListener('change', () => { s.genre = genreSel.value; s.shown = PAGE; sync(); paint(); });
  const fillGenres = () => {
    const names = [...new Set(games.map((g) => g.genre))].filter(Boolean).sort();
    if (s.genre && !names.includes(s.genre)) names.push(s.genre);
    genreSel.replaceChildren(h('option', { value: '', text: 'Semua genre' }), ...names.map((n) => h('option', { value: n, text: n })));
    genreSel.value = s.genre;
  };

  // Ringkasan filter aktif + tombol hapus semua
  function paintActive() {
    const on = [
      s.q && ['q', `Cari: “${s.q}”`],
      s.platform && ['platform', PLATFORMS.find(([v]) => v === s.platform)?.[1]],
      s.category && ['category', `Kategori: ${s.category}`],
      s.genre && ['genre', `Genre: ${s.genre}`],
      s.sort !== 'popularity' && ['sort', `Urut: ${SORTS_SHORT[s.sort]}`],
    ].filter(Boolean);
    active.replaceChildren(...(on.length
      ? [h('span', { class: 'lbl', text: 'Filter aktif' }),
        ...on.map(([key, label]) => h('button', {
          class: 'chip on', type: 'button', 'aria-label': `Hapus filter ${label}`,
          onclick: () => dropFilter(key),
        }, label, icon('x'))),
        h('button', { class: 'chip', type: 'button', onclick: reset }, 'Hapus semua')]
      : []));
  }

  // Urutan penting: ubah state + kontrol dulu, baru muat ulang, agar request
  // tidak terkirim dengan nilai filter lama.
  function dropFilter(key) {
    if (key === 'q') input.value = '';
    if (key === 'sort') {
      s.sort = 'popularity';
      segBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SORTS[i][0] === 'popularity')));
    } else {
      s[key] = '';
      if (selects[key]) selects[key].value = '';
      if (key === 'genre') genreSel.value = '';
    }
    s.shown = PAGE;
    sync();
    if (key === 'platform' || key === 'category' || key === 'sort') refresh();
    else paint();
  }

  function paint() {
    const q = s.q.toLowerCase();
    let list = games.filter((g) => (!s.genre || g.genre === s.genre) && (!q || g.title.toLowerCase().includes(q)));
    // "Rating tertinggi" murni sisi klien: API FreeToGame tidak punya endpoint
    // penilaian, jadi skor diambil dari vote.js yang sudah dimuat.
    if (s.sort === 'rating') {
      list = [...list].sort((a, b) => vote.score(Number(b.id)) - vote.score(Number(a.id)) || a.title.localeCompare(b.title));
    }
    const showing = Math.min(s.shown, list.length);
    clearBtn.hidden = !s.q;
    kbd.hidden = !!s.q;
    count.replaceChildren(
      h('b', { text: `${list.length} game` }),
      document.createTextNode(list.length ? ` ditemukan${s.genre || s.q ? ' setelah filter' : ''} · menampilkan ${showing}` : ''));
    more.hidden = list.length <= s.shown;
    results.replaceChildren(list.length
      ? ui.grid(list.slice(0, s.shown), isFav, voteOpts())
      : ui.stateBox('Tidak ada game yang cocok', 'Coba kata kunci lain atau longgarkan filter.', 'search',
        h('button', { class: 'btn primary', type: 'button', onclick: reset }, 'Reset filter')));
    paintActive();
    reveal(results);
  }

  async function refresh() {
    const id = ++requestId;
    results.replaceChildren(ui.skeletonGrid(8));
    more.hidden = true;
    count.textContent = 'Memuat…';
    try {
      // 'rating' bukan parameter API; kirim urutan bawaan lalu sortir klien.
      games = await getGames({
        platform: s.platform,
        category: s.category,
        sort: s.sort === 'rating' ? 'relevance' : s.sort,
      });
    } catch (err) {
      if (id !== requestId) return;
      count.textContent = '';
      return results.replaceChildren(ui.errorState(err, refresh));
    }
    if (id !== requestId) return;
    remember(games);
    fillGenres();
    paint();
  }

  const toggle = h('button', {
    class: 'btn filters-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'filters-grid',
    onclick: () => toggle.setAttribute('aria-expanded', String(filterPanel.classList.toggle('open'))),
  }, icon('chev'), 'Filter');
  filterPanel.append(
    h('div', { class: 'filters-bar' }, toggle),
    h('div', { class: 'filters-grid', id: 'filters-grid' },
      h('label', { class: 'wide' }, 'Cari judul', search),
      field('Platform', 'platform', PLATFORMS),
      field('Kategori (tag)', 'category', [['', 'Semua kategori'], ...TAGS.map((t) => [t, t])]),
      h('label', {}, 'Genre', genreSel),
      h('label', { class: 'wide field-lb' }, 'Urutkan', seg),
      h('div', { class: 'wide' }, recents)));

  view.replaceChildren(
    h('h1', { class: 'page-title', text: 'Katalog game' }),
    h('p', { class: 'page-sub', text: 'Filter yang kamu pilih tersimpan di URL, jadi bisa dibagikan.' }),
    filterPanel,
    active, count, results, h('div', { class: 'more' }, more));
  stage();
  onScroll();
  drawRecents();
  fillGenres();
  refresh();
}

/* ---------- Detail & Favorit ---------- */
// Komentar: satu handler yang dipakai oleh section di components.js.
const commentHandlers = (onChanged) => ({
  load: (gameId) => comment.api.list(gameId),
  onCreate: async (payload, done) => {
    try {
      const res = await comment.api.create(payload);
      done('', res.comment);
      onChanged?.();
    } catch (err) {
      done(err.message, null);
    }
  },
  onEdit: async (c, text, done) => {
    try {
      const res = await comment.api.edit(c.id, text);
      done('', res.comment);
    } catch (err) {
      done(err.message, null);
    }
  },
  onDelete: async (c, done) => {
    try {
      await comment.api.remove(c.id);
      done('');
      onChanged?.();
    } catch (err) {
      done(err.message);
    }
  },
  onLike: async (c, done) => {
    try {
      const res = await comment.api.like(c.id);
      done('', res);
    } catch (err) {
      done(err.message, null);
    }
  },
});

const renderDetail = (id) => guarded(ui.skeletonGrid(2), async () => {
  const g = await getGame(id);
  remember([g]);
  return g;
}, (g) => {
  document.title = `${g.title} - GameList`;
  const back = () => (history.length > 1 ? history.back() : navigate('/games'));
  const section = ui.commentSection(g.id, { user, handlers: commentHandlers() });
  view.replaceChildren(
    h('button', { class: 'btn back', type: 'button', onclick: back }, 'Kembali'),
    ui.detailView(g, isFav(g.id), voteOpts()),
    section.root);
  reveal(view);
  stage();
  onScroll();
  section.load();
});

function renderFavorites() {
  if (!favs.length) {
    view.replaceChildren(ui.stateBox('Belum ada favorit', 'Tekan ikon hati pada kartu game untuk menyimpannya di sini.', 'heart',
      h('a', { class: 'btn primary', href: '#/games', text: 'Jelajahi katalog' })));
  } else {
    const g = ui.grid(favs, isFav, voteOpts());
    view.replaceChildren(h('h1', { class: 'page-title', text: `Favorit (${favs.length})` }), g);
    reveal(view);
  }
  stage();
  onScroll();
}

function toggleFav(id) {
  const g = known.get(id);
  if (!g) return;
  const on = !isFav(id);
  favs = on ? [...favs, summary(g)] : favs.filter((f) => f.id !== id);
  store.set(KEY_FAV, favs);
  document.querySelectorAll(`[data-fav="${id}"]`).forEach((b) => ui.setFavState(b, on));
  updateBadge();
  ui.toast(on ? `“${g.title}” ditambahkan ke favorit` : `“${g.title}” dihapus dari favorit`, on ? 'heart' : 'trash');
  if (user) pushFavorites();
  if (parseHash().segments[0] === 'favorites') renderFavorites();
}

function updateBadge() {
  const badge = document.getElementById('fav-count');
  badge.textContent = favs.length;
  badge.hidden = favs.length === 0;
}

/* ---------- Penilaian game (wajib login) ---------- */
const voteOpts = () => ({ onVote: onVote, hint: user ? undefined : 'Masuk untuk menyimpan penilaianmu' });
let votesKnown = false;

// Satu handler untuk semua voteBar; komponen sudah menerapkan perubahan secara
// optimistis, jadi di sini kita hanya perlu menyimpan lalu membetulkan status.
async function onVote(gameId, value, repaint) {
  if (!user) {
    // Login dulu: kembalikan pengguna ke halaman yang sedang dilihat.
    // Disimpan sebagai path (tanpa '#') karena navigate() menambahkannya sendiri.
    sessionStorage.setItem(KEY_RETURN, (location.hash || '#/').slice(1));
    ui.toast('Masuk dulu untuk menyimpan penilaianmu', 'lock');
    navigate('/masuk');
    return;
  }
  try {
    const res = await vote.api.save({ [gameId]: value });
    vote.setState(res);
    votesKnown = true;
  } catch (err) {
    if (vote.isUnauthenticated(err)) {
      vote.applyLocal(gameId, 'none'); // balikkan perubahan optimistis
      setUser(null);
      paintAccountNav();
      ui.toast('Sesi berakhir, silakan masuk lagi', 'lock');
    } else {
      ui.toast(err.message, 'refresh');
    }
  } finally {
    // Sinkronkan semua voteBar di halaman (kartu lain ikut ter-update).
    view.querySelectorAll('.v-bar').forEach((bar) => bar.sync?.());
    repaint?.();
  }
}

async function loadVotes() {
  try {
    vote.setState(await vote.api.read());
  } catch (err) {
    console.warn('[vote]', err.message);
  } finally {
    votesKnown = true;
    view.querySelectorAll('.v-bar').forEach((bar) => bar.sync?.());
  }
}

/* ---------- Halaman akun ---------- */
function renderAuth(mode) {
  if (user) return navigate('/');
  view.replaceChildren(h('div', { class: 'auth-wrap' }, ui.authForm({
    mode,
    onSubmit: async (values, done) => {
      try {
        const res = mode === 'register'
          ? await account.api.register(values)
          : await account.api.login(values.username, values.password);
        await afterLogin(res.user, mode === 'register');
        done('');
      } catch (err) {
        done(err.message);
      }
    },
  })));
  stage();
  onScroll();
}

async function afterLogin(nextUser, isNew) {
  setUser(nextUser);
  paintAccountNav();
  if (isNew) ui.toast(`Akun @${nextUser.username} dibuat`, 'user');
  await migrateFavorites();
  // Reaksi yang baru saja dibuat ikut ikut tersinkron (halaman sebelumnya
  // mungkin menampilkan angka sebelum user masuk).
  await loadVotes();
  ui.toast(`Selamat datang, ${nextUser.display_name || nextUser.username}`, 'user');
  // Kalau user arrive dari vote yang butuh login, kembalikan ke halaman itu.
  // buildHash() sudah menambahkan '#', jadi simpan path tanpa '#' agar tidak
  // menjadi '##/games'.
  const back = sessionStorage.getItem(KEY_RETURN);
  sessionStorage.removeItem(KEY_RETURN);
  const safe = back && back.startsWith('/') ? back : null;
  navigate(safe || '/profil');
}

async function renderProfile() {
  if (!userKnown) {
    view.replaceChildren(ui.skeletonGrid(1));
    return;
  }
  if (!user) {
    view.replaceChildren(ui.stateBox('Kamu belum masuk', 'Masuk dulu untuk melihat dan mengubah profilmu.', 'lock',
      h('div', { class: 'actions' },
        h('a', { class: 'btn primary', href: '#/masuk', text: 'Masuk' }),
        h('a', { class: 'btn', href: '#/daftar', text: 'Daftar' }))));
    stage();
    onScroll();
    return;
  }
  view.replaceChildren(ui.profileView({
    user,
    onSave: async (patch, done) => {
      try {
        const res = await account.api.updateProfile(patch);
        setUser(res.user);
        paintAccountNav();
        done('');
      } catch (err) {
        done(err.message);
      }
    },
    onAvatar: async (file, done) => {
      try {
        const res = await account.api.uploadAvatar(file);
        setUser(res.user);
        paintAccountNav();
        done('', res.user);
      } catch (err) {
        done(err.message, user);
      }
    },
    onRemoveAvatar: async (done) => {
      try {
        const res = await account.api.removeAvatar();
        setUser(res.user);
        paintAccountNav();
        done('', res.user);
      } catch (err) {
        done(err.message, user);
      }
    },
    onLogout: async () => {
      try {
        await account.api.logout();
      } catch { /* cookie mungkin sudah kadaluarsa */ }
      setUser(null);
      paintAccountNav();
      // Reaksi milik user ikut hilang dari tampilan setelah keluar.
      vote.setState({ mine: {} });
      view.querySelectorAll('.v-bar').forEach((bar) => bar.sync?.());
      ui.toast('Kamu sudah keluar', 'user');
      navigate('/');
    },
  }));
  stage();
  onScroll();
}

/* ---------- Router & event global ---------- */
function route({ segments, params }) {
  requestId++;
  const [a, b] = segments;
  document.title = 'GameList - Katalog Game Free-to-Play';
  menu.classList.remove('open');
  burger.setAttribute('aria-expanded', 'false');
  const active = a === 'game' ? 'games' : a || 'home';
  // Tandai link aktif di menu utama maupun slot akun.
  document.querySelectorAll('[data-route]').forEach((l) => (l.dataset.route === active ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current')));
  window.scrollTo(0, 0);
  if (!a) renderHome();
  else if (a === 'games') renderCatalog(params);
  else if (a === 'game' && b) renderDetail(b);
  else if (a === 'favorites') renderFavorites();
  else if (a === 'masuk') renderAuth('login');
  else if (a === 'daftar') renderAuth('register');
  else if (a === 'profil') renderProfile();
  else {
    view.replaceChildren(ui.stateBox('Halaman tidak ditemukan', 'Alamat yang kamu buka tidak tersedia.', 'search',
      h('a', { class: 'btn primary', href: '#/', text: 'Ke beranda' })));
    stage();
  }
  view.focus({ preventScroll: true });
}

document.addEventListener('click', (e) => {
  const fav = e.target.closest('[data-fav]');
  if (fav) toggleFav(Number(fav.dataset.fav));
  else if (e.target.closest('#burger')) burger.setAttribute('aria-expanded', String(menu.classList.toggle('open')));
  else if (e.target.closest('#theme')) toggleTheme();
  else if (e.target.closest('#to-top')) window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
});

// Pintasan papan ketik: "/" fokus ke pencarian, Escape menutup menu atau mengosongkan pencarian.
const searchBox = () => view.querySelector('input[type=search]');
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    menu.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    if (e.target === searchBox()) {
      e.target.value = '';
      e.target.dispatchEvent(new Event('input'));
    }
    return;
  }
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && searchBox()) {
    e.preventDefault();
    searchBox().focus();
    searchBox().select();
  }
});

// Sheen: gradien lembut pada kartu mengikuti posisi kursor.
addEventListener('pointermove', (e) => {
  const card = e.target?.closest?.('.card');
  if (!card || reduced) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(0)}px`);
  card.style.setProperty('--my', `${(e.clientY - r.top).toFixed(0)}px`);
}, { passive: true });

document.querySelector('.brand').prepend(icon('pad'));
burger.append(icon('menu'));
topBtn.append(icon('up'));
remember(favs);
updateBadge();
paintAccountNav();
initRouter(route);

// Sesi dicek setelah render pertama supaya beranda tidak menunggu round-trip.
// Halaman profil yang dibuka langsung lewat URL harus menunggu data user.
const deepLinkProfile = parseHash().segments[0] === 'profil';
if (deepLinkProfile) {
  view.replaceChildren(ui.skeletonGrid(1));
  stage();
}
refreshUser().then(() => {
  // Counters vote tidak bergantung sesi, tapi `mine` iya — muat setelahnya.
  loadVotes();
  if (deepLinkProfile) route(parseHash());
});

// Tab yang kembali aktif setelah lama ditinggal bisa punya access token
// kedaluwarsa. Segarkan diam-diam supaya UI tidak tiba-tiba terasa "keluar".
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !userKnown) return;
  if (Date.now() - lastActiveAt < 4 * 60 * 1000) return; // baru saja aktif
  lastActiveAt = Date.now();
  account.api.me().then((res) => { if (res?.user) setUser(res.user); }).catch(() => {});
});