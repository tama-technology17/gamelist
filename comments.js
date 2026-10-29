// Penyimpanan & validasi komentar game (server only).
// Aturan produk: */
//   - siapa pun boleh komentar, dengan atau tanpa akun (anonim wajib nama)
//   - hanya pemilik komentar yang bisa edit/hapus
//   - hanya pengguna terdaftar yang bisa memberi suka
const { comments } = require('./db');

const MAX_TEXT = 600;
const MAX_NAME = 24;
const MIN_NAME = 2;
const MAX_PER_GAME = 300; // batasi agar satu game tidak membanjiri storage

/* ---------------------------- Validasi ---------------------------- */
// Karakter kontrol, variation selector, dan zero-width dibuang supaya teks
// tidak bisa merusak layout maupun menyamar sebagai karakter lain.
// PENTING: \n dan \t adalah karakter kontrol juga (U+000A / U+0009) tapi
// justru harus dipertahankan agar komentar bisa ditulis beberapa baris.
const KEEP_WHITESPACE = new Set(['\n', '\t']);
const CLEAN = /[\p{Cc}\p{Cf}]/gu;

function cleanText(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(CLEAN, (ch) => (KEEP_WHITESPACE.has(ch) ? ch : ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function validateComment(body, { isGuest }) {
  const text = cleanText(body.text);
  if (!text) return { error: 'Komentar tidak boleh kosong.' };
  if (text.length > MAX_TEXT) return { error: `Komentar maksimal ${MAX_TEXT} karakter (sekarang ${text.length}).` };

  // Tanpa akun, nama wajib diisi; dengan akun, nama diambil dari profil.
  const name = isGuest ? cleanText(body.display_name) : '';
  if (isGuest) {
    if (name.length < MIN_NAME) return { error: `Nama minimal ${MIN_NAME} karakter.` };
    if (name.length > MAX_NAME) return { error: `Nama maksimal ${MAX_NAME} karakter.` };
  }

  const gameId = Number(body.gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) return { error: 'ID game tidak valid.' };

  return { value: { text, name, gameId } };
}

function validateEdit(body) {
  const text = cleanText(body.text);
  if (!text) return { error: 'Komentar tidak boleh kosong.' };
  if (text.length > MAX_TEXT) return { error: `Komentar maksimal ${MAX_TEXT} karakter.` };
  return { value: { text } };
}

/* ------------------------------ Query ------------------------------ */
const listForGame = (gameId, limit = MAX_PER_GAME) =>
  comments.data.comments
    .filter((c) => c.gameId === gameId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);

const find = (id) => comments.data.comments.find((c) => c.id === id) || null;

const countForGame = (gameId) => comments.data.comments.reduce((n, c) => n + (c.gameId === gameId ? 1 : 0), 0);

function add({ gameId, text, name }, user) {
  const entry = {
    id: comments.data.nextId++,
    gameId,
    // null berarti anonim; string berisi username pemilik.
    author: user ? user.username : null,
    displayName: user ? (user.display_name || user.username) : name,
    text,
    createdAt: Date.now(),
    editedAt: null,
    likes: [],
  };
  comments.data.comments.push(entry);
  // Buang komentar terlama bila sebuah game melewati batas, biar file tidak tumbuh tanpa akhir.
  const mine = comments.data.comments.filter((c) => c.gameId === gameId);
  if (mine.length > MAX_PER_GAME) {
    const drop = new Set(mine.slice(MAX_PER_GAME).map((c) => c.id));
    comments.data.comments = comments.data.comments.filter((c) => !drop.has(c.id));
  }
  comments.flush();
  return entry;
}

const edit = (entry, text) => {
  entry.text = text;
  entry.editedAt = Date.now();
  comments.flush();
  return entry;
};

const remove = (entry) => {
  comments.data.comments = comments.data.comments.filter((c) => c.id !== entry.id);
  comments.flush();
};

// Suka hanya dari akun terdaftar, satu like per username.
function toggleLike(entry, username) {
  const at = entry.likes.indexOf(username);
  if (at >= 0) entry.likes.splice(at, 1);
  else entry.likes.push(username);
  comments.flush();
  return at < 0;
}

const owns = (entry, user) => !!user && !!entry.author && entry.author === user.username;

/* --------------------------- Serialisasi --------------------------- */
function publicComment(entry, viewer) {
  const liked = !!viewer && entry.likes.includes(viewer.username);
  return {
    id: entry.id,
    gameId: entry.gameId,
    author: entry.author,
    displayName: entry.displayName,
    text: entry.text,
    createdAt: entry.createdAt,
    editedAt: entry.editedAt,
    likes: entry.likes.length,
    liked,
    mine: owns(entry, viewer),
  };
}

module.exports = {
  MAX_TEXT, MAX_NAME, MIN_NAME, MAX_PER_GAME,
  cleanText, validateComment, validateEdit,
  listForGame, find, countForGame, add, edit, remove, toggleLike, owns,
  publicComment,
};