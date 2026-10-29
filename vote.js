// Klien penilaian game (browser). Sama seperti account.js/comment.js: selalu
// same-origin, tidak pernah memakai BASE dari api.js, dan mewarisi
// refresh-otomatis dari account.js.
//   - Membaca counts/mine: Boleh tanpa login
//   - Menyimpan reaksi: WAJIB punya sesi (server menolak 401 bila tidak)

import { call, AuthError, isUnauthenticated } from './account.js';

export { AuthError, isUnauthenticated };

export const api = {
  // Publik: `mine` akan kosong bila belum login.
  read: () => call('/api/votes'),
  // Butuh login. Kirim map { gameId: 'like' | 'dislike' | 'none' }.
  save: (reactions) => call('/api/votes', { method: 'PUT', body: { reactions } }),
};

/* ------------------------------ State ------------------------------- */
// Dimuat sekali saat boot lalu disinkronkan setiap kali ada suara baru,
// supaya semua kartu/profil ikut ter-update tanpa fetch per kartu.
let counts = {};
let mine = {};

export const getCounts = () => counts;
export const getMine = () => mine;

export const score = (gameId) => {
  const slot = counts[gameId];
  return slot ? slot.likes - slot.dislikes : 0;
};

export const reactionOf = (gameId) => mine[gameId] || null;

export function setState({ counts: c, mine: m }) {
  if (c && typeof c === 'object') counts = c;
  if (m && typeof m === 'object') mine = m;
}

// Optimistic: tampilkan hasil sebelum server sempat menjawab.
export function applyLocal(gameId, value) {
  const prev = mine[gameId];
  if (prev) {
    const slot = (counts[gameId] ||= { likes: 0, dislikes: 0 });
    if (prev === 'like') slot.likes = Math.max(0, slot.likes - 1);
    else slot.dislikes = Math.max(0, slot.dislikes - 1);
  }
  if (value === 'like') {
    const slot = (counts[gameId] ||= { likes: 0, dislikes: 0 });
    slot.likes++;
    mine[gameId] = 'like';
  } else if (value === 'dislike') {
    const slot = (counts[gameId] ||= { likes: 0, dislikes: 0 });
    slot.dislikes++;
    mine[gameId] = 'dislike';
  } else {
    delete mine[gameId];
  }
}

// "Menekan lagi tombol yang sama" berarti batal.
export const toggle = (gameId, value) => (reactionOf(gameId) === value ? 'none' : value);

export const isEmpty = () => Object.keys(counts).length === 0;