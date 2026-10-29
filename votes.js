// Penilaian game (like / dislike) — server only.
// Aturan produk:
//   - WAJIB login; identitas diambil dari sesi, tidak pernah dari body
//   - satu orang satu suara per game (like ATAU dislike, bukan keduanya)
//   - Counts boleh dibaca tanpa login supaya angka terlihat hidup
const { votes } = require('./db');

const VALUES = { like: 1, dislike: -1 };
const MAX_PER_REQUEST = 200; // batasi ukuran satu payload PUT

/* ---------------------------- Validasi ---------------------------- */
function validateGameId(raw) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

// Body: { reactions: { "517": "like" | "dislike" | "none" } }
function validateReactions(body) {
  const raw = body?.reactions;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'Format reactions tidak valid.' };
  }
  const entries = Object.entries(raw);
  if (!entries.length) return { error: 'Tidak ada perubahan.' };
  if (entries.length > MAX_PER_REQUEST) {
    return { error: `Maksimal ${MAX_PER_REQUEST} game per permintaan.` };
  }

  const clean = {};
  for (const [key, value] of entries) {
    const gameId = validateGameId(key);
    if (gameId === null) return { error: `ID game tidak valid: ${key}` };
    if (value !== 'like' && value !== 'dislike' && value !== 'none') {
      return { error: `Nilai tidak dikenal untuk game ${gameId}.` };
    }
    clean[gameId] = value;
  }
  return { value: clean };
}

/* ----------------------------- Penyimpanan ----------------------------- */
// Satu baris per (userId, gameId). Diindeks ulang di memori supaya tidak perlu
// scan seluruh tabel tiap kali ada suara baru.
let index = new Map();
const indexKey = (userId, gameId) => `${userId}:${gameId}`;

function reindex() {
  index = new Map(votes.data.votes.map((v) => [indexKey(v.userId, v.gameId), v]));
}
reindex();

// Panggil setelah ada perubahan votes.data.votes di luar modul ini.
function refreshIndex() { reindex(); }

const findVote = (userId, gameId) => index.get(indexKey(userId, gameId)) || null;

/**
 * Terapkan sekumpulan reaksi. Mengembalikan gameId yang benar-benar berubah.
 * Nilai 'none' menghapus suara (klik ulang pada tombol yang sama = batal).
 */
function apply(user, reactions) {
  const changed = [];
  for (const [gameId, value] of Object.entries(reactions)) {
    const existing = findVote(user.id, Number(gameId));
    if (value === 'none') {
      if (!existing) continue;
      votes.data.votes = votes.data.votes.filter((v) => v.id !== existing.id);
      index.delete(indexKey(user.id, Number(gameId)));
      changed.push(Number(gameId));
      continue;
    }
    const next = VALUES[value];
    if (existing) {
      if (existing.value === next) continue; // tidak berubah
      existing.value = next;
      existing.updatedAt = Date.now();
    } else {
      const row = {
        id: votes.data.nextId++,
        userId: user.id,
        gameId: Number(gameId),
        value: next,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      votes.data.votes.push(row);
      index.set(indexKey(user.id, Number(gameId)), row);
    }
    changed.push(Number(gameId));
  }
  if (changed.length) votes.flush();
  return changed;
}

/* ------------------------------- Query -------------------------------- */
// Total per game untuk semua game yang punya suara.
function counts() {
  const out = {};
  for (const v of votes.data.votes) {
    const slot = (out[v.gameId] ||= { likes: 0, dislikes: 0 });
    if (v.value > 0) slot.likes++;
    else slot.dislikes++;
  }
  return out;
}

// Reaksi milik satu pengguna: { gameId: 'like' | 'dislike' }
function reactionsOf(user) {
  const out = {};
  if (!user) return out;
  for (const v of votes.data.votes) {
    if (v.userId === user.id) out[v.gameId] = v.value > 0 ? 'like' : 'dislike';
  }
  return out;
}

// Skor untuk sortir "rating": like = +1, dislike = -1, net.
const scoreOf = (slot) => (slot ? slot.likes - slot.dislikes : 0);

module.exports = { VALUES, MAX_PER_REQUEST, validateGameId, validateReactions, apply, counts, reactionsOf, scoreOf, findVote, refreshIndex };