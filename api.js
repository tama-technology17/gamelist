// Semua komunikasi dengan FreeToGame API ada di sini.
import { store } from './utils.js';

const DIRECT = 'https://www.freetogame.com/api';

// ?api=/api memakai proxy lokal (lihat server.js); ?api= (kosong) kembali ke API langsung.
const override = new URLSearchParams(location.search).get('api');
if (override !== null) store.set('gamelist:api', override);
export const BASE = store.get('gamelist:api', '') || DIRECT;

// Tag resmi dari dokumentasi FreeToGame (nilai untuk parameter "category").
export const TAGS = 'mmorpg shooter strategy moba racing sports social sandbox open-world survival pvp pve pixel voxel zombie turn-based first-person third-person top-down tank space sailing side-scroller superhero permadeath card battle-royale mmo mmofps mmotps 3d 2d anime fantasy sci-fi fighting action-rpg action military martial-arts flight low-spec tower-defense horror mmorts'.split(' ');

export class ApiError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const memory = new Map();

async function request(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;

  if (memory.has(url)) return memory.get(url);
  try {
    const saved = sessionStorage.getItem(`gl:${url}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      memory.set(url, parsed);
      return parsed;
    }
  } catch {
    /* cache rusak, abaikan */
  }

  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('network', 'Tidak dapat menghubungi FreeToGame API. Periksa koneksi internet. Jika dibuka lewat localhost, kemungkinan diblokir CORS (lihat README: jalankan node server.js).');
  }
  if (res.status === 404) throw new ApiError('notfound', 'Game atau endpoint tidak ditemukan.');
  if (!res.ok) throw new ApiError('http', `Server API mengembalikan status ${res.status}.`);

  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('json', 'Respons API bukan JSON yang valid.');
  }

  if (!(Array.isArray(data) && data.length === 0)) {
    memory.set(url, data);
    try {
      sessionStorage.setItem(`gl:${url}`, JSON.stringify(data));
    } catch {
      /* kuota penuh */
    }
  }
  return data;
}

// platform: "windows" | "browser" | "" (semua). sort: popularity | release-date | alphabetical | relevance.
export async function getGames({ platform = '', category = '', sort = '' } = {}) {
  const data = await request('/games', { platform, category, 'sort-by': sort });
  if (!Array.isArray(data)) throw new ApiError('json', data?.status_message || 'Format data game tidak dikenali.');
  return data;
}

export async function getGame(id) {
  if (!/^\d+$/.test(String(id))) throw new ApiError('notfound', 'ID game tidak valid.');
  const data = await request('/game', { id });
  if (!data || data.status === 0 || !data.id) throw new ApiError('notfound', data?.status_message || 'Game tidak ditemukan.');
  return data;
}
