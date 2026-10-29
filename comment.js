// Klien komentar (browser). Sama seperti account.js: selalu same-origin,
// tidak pernah memakai BASE dari api.js.
// Memakai call() dari account.js supaya ikut mewarisi refresh-otomatis saat
// access token kedaluwarsa.
//   - Komentar boleh anonim (wajib nama) maupun dari akun.
//   - Edit/hapus hanya untuk pemilik komentar.
//   - Suka hanya untuk pengguna terdaftar.

import { call, AuthError, isUnauthenticated } from './account.js';

export { AuthError, isUnauthenticated };

export const MAX_TEXT = 600;
export const MAX_NAME = 24;

// Batas harus sama dengan comments.js di server.
export const LIMITS = { text: MAX_TEXT, name: MAX_NAME, nameMin: 2 };

export const api = {
  list: (gameId) => call(`/api/comments?game=${encodeURIComponent(gameId)}`),
  create: (payload) => call('/api/comments', { method: 'POST', body: payload }),
  edit: (id, text) => call(`/api/comments/${encodeURIComponent(id)}`, { method: 'PATCH', body: { text } }),
  remove: (id) => call(`/api/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  like: (id) => call(`/api/comments/${encodeURIComponent(id)}/like`, { method: 'POST' }),
};

/* ------------------------------ Emoji ------------------------------ */
// Kumpulan terkurasi (shortcode + emoji) — tanpa dependensi eksternal.
// Dipakai untuk picker; disimpan recent di localStorage.
export const EMOJI = {
  senyum: [
    ['senang', '😀'], ['tertawa', '😂'], ['ngakak', '😆'], ['wkwk', '😅'], ['muka panas', '🥵'], ['mikir', '🤔'],
    ['bingung', '😕'], ['skeptis', '🤨'], ['sedih', '😢'], ['nangis', '😭'], ['marah', '😠'], ['kesal', '😤'],
    ['ngantuk', '😴'], ['pusing', '😵'], ['mata hati', '😍'], ['ciumin', '😘'], ['peluk', '🥰'], ['gigitan', '😻'],
    ['muka jutek', '😒'], ['muka mr', '🙄'], ['sengau', '🥺'], ['muka redup', '😐'], ['senyum tipis', '🙂'], ['maling', '🥸'],
    ['marah besar', '🤬'], ['nangis bombong', '🫠'], ['kaget', '😱'], ['mata ngatuk', '🥱'], ['melongo', '😳'],
  ],
  game: [
    ['pad', '🎮'], ['controller', '🕹️'], ['trophy', '🏆'], ['medali', '🥇'], ['medali perak', '🥈'], ['target', '🎯'],
    ['roket', '🚀'], ['bintang', '⭐'], ['bintang kilau', '✨'], ['globe', '🌍'], ['bola', '⚽'], ['basket', '🏀'],
    ['voli', '🏐'], ['dadu', '🎲'], ['puzzle', '🧩'], ['drone', '🛸'], ['perisai', '🛡️'], ['pedang', '⚔️'],
    ['sihir', '🔮'], ['monster', '👾'], ['hantu', '👻'], ['robot', '🤖'], ['alien', '👽'], ['unicorn', '🦄'],
    ['naga', '🐲'], ['kerbau', '🐂'], ['kucing', '🐱'], ['anjing', '🐶'], ['ayam', '🐔'], ['ikan', '🐟'],
  ],
  tangan: [
    ['ok', '👌'], ['jempol', '👍'], ['jempol bawah', '👎'], ['acik jempol', '🤞'], ['metal', '🤘'], ['menggoda', '😏'],
    ['tepuk', '👏'], ['geleng', '🙅'], ['angguk', '🙆'], ['doa', '🙏'], ['otot', '💪'], ['tunjuk', '👉'],
    ['sapa', '🤝'], ['hati', '❤️'], ['hati oranye', '🧡'], ['hati kuning', '💛'], ['hati hijau', '💚'],
    ['hati biru', '💙'], ['hati ungu', '💜'], ['hati hitam', '🖤'], ['hati putih', '🤍'], ['hati patah', '💔'], ['cinta', '💖'],
  ],
  reaksi: [
    ['api', '🔥'], ['keren', '😎'], ['mantap', '👍🏻'], ['gagal', '💀'], ['skor', '💯'], ['bantuan', '🆘'],
    ['loading', '⏳'], ['menunggu', '⌛'], ['server', '🖥️'], ['internet', '🌐'], ['database', '🗄️'], ['bug', '🐛'],
    ['kode', '💻'], ['berlari', '🏃'], ['jalan', '🚶'], ['lompat', '🤸'], ['berlutut', '🧎'], ['angkat tangan', '🙌'],
    ['diam', '🤫'], ['berpikir', '🤭'], ['santai', '😌'], ['stres', '😫'], ['panas', '🥶'], ['mual', '🤢'],
  ],
  benda: [
    ['dokumen', '📄'], ['memo', '📝'], ['buku', '📚'], ['kunci', '🔑'], ['gembok', '🔒'], ['buka gembok', '🔓'],
    ['cermin', '🪞'], ['lampu', '💡'], ['jam', '⏰'], ['map', '🗺️'], ['lokasi', '📍'], ['berkas', '📁'],
    ['label', '🏷️'], ['arsip', '🗃️'], ['tiket', '🎟️'], ['hadiah', '🎁'], ['toko', '🛒'], ['uang', '💰'],
    ['koin', '🪙'], ['kartu', '💳'], ['kaca', '🔍'], ['senter', '🔦'], ['palu', '🔨'], ['obeng', '🔧'],
  ],
  simbol: [
    ['check', '✅'], ['silang', '❌'], ['tanda seru', '❗'], ['tanda tanya', '❓'], ['info', 'ℹ️'], ['larang', '🚫'],
    ['wajib', '⚠️'], ['garis atas', '➕'], ['garis bawah', '➖'], ['gelombang', '〰️'], ['mata bintang', '💫'],
    ['bola salju', '☃️'], ['ledakan', '💥'], ['asap', '💨'], ['pelangi', '🌈'], ['gunung', '⛰️'], ['gunung api', '🌋'],
    ['lampu merah', '🚨'], ['lampu hijau', '🚦'], ['link', '🔗'], ['surel', '✉️'], ['sinar', '🔆'], ['tombol', '🔘'],
  ],
};

// Buang duplikat shortcode (baris pertama menang) supaya pencarian tidak ambigu.
const cleanEmoji = () => {
  const seen = new Set();
  for (const [cat, list] of Object.entries(EMOJI)) {
    EMOJI[cat] = list.filter(([k]) => {
      const key = k.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
};
cleanEmoji();

// Flat untuk pencarian.
export const EMOJI_ALL = Object.entries(EMOJI)
  .flatMap(([cat, list]) => list.map(([key, ch]) => ({ key, ch, cat })));

// Nama kategori untuk tab picker.
export const EMOJI_CATS = [
  ['senyum', '😀 Senang'],
  ['game', '🎮 Game'],
  ['tangan', '👍 Tangan'],
  ['reaksi', '🔥 Reaksi'],
  ['benda', '💡 Benda'],
  ['simbol', '✅ Simbol'],
];

const KEY_RECENT = 'gamelist:emoji';
export const recentEmoji = {
  read() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY_RECENT) || '[]');
      return Array.isArray(v) ? v.filter((e) => typeof e.ch === 'string').slice(0, 24) : [];
    } catch {
      return [];
    }
  },
  push(ch) {
    const list = recentEmoji.read().filter((e) => e.ch !== ch);
    list.unshift({ key: '', ch });
    try {
      localStorage.setItem(KEY_RECENT, JSON.stringify(list.slice(0, 24)));
    } catch { /* storage penuh */ }
  },
};

/* -------------------------- Waktu relatif -------------------------- */
const UNITS = [[31536e6, 'tahun'], [2592e6, 'bulan'], [6048e5, 'minggu'], [864e5, 'hari'], [36e5, 'jam'], [6e4, 'menit']];

export function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 45e3) return 'baru saja';
  for (const [ms, label] of UNITS) {
    const n = Math.floor(diff / ms);
    if (n >= 1) return `${n} ${label} lalu`;
  }
  return 'baru saja';
}