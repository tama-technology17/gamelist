// Penyimpanan JSON sederhana: seluruh isi file dimuat ke memori, ditulis ulang
// secara atomik (tulis ke .tmp lalu rename) setiap ada perubahan.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const WRITE_DEBOUNCE = 40; // ms, menggabungkan banyak perubahan beruntun

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    // File rusak tidak boleh menjatuhkan server; simpan salinannya lalu mulai ulang.
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      console.warn(`[db] ${path.basename(file)} rusak, dipindahkan aside: ${err.message}`);
    } catch { /* tidak bisa menyimpan salinan */ }
    return fallback;
  }
}

class Table {
  constructor(name, fallback) {
    this.file = path.join(DATA_DIR, `${name}.json`);
    this.data = readJSON(this.file, fallback);
    this.timer = null;
    this.writing = false;
    this.pending = false;
  }

  // Serialisasi penulisan: satu antrean, tidak saling menimpa.
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, WRITE_DEBOUNCE);
  }

  flush() {
    if (this.writing) { this.pending = true; return; }
    this.writing = true;
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      // Jaring pengaman untuk file lama yang mode-nya sudah terlanjur longgar.
      try { fs.chmodSync(this.file, 0o600); } catch { /* bukan unix */ }
    } catch (err) {
      console.error(`[db] gagal menulis ${path.basename(this.file)}:`, err.message);
      try { fs.unlinkSync(tmp); } catch { /* sudah tidak ada */ }
    } finally {
      this.writing = false;
      if (this.pending) { this.pending = false; this.flush(); }
    }
  }
}

const users = new Table('users', { nextId: 1, users: [] });
const sessions = new Table('sessions', { nextId: 1, sessions: [] });
const comments = new Table('comments', { nextId: 1, comments: [] });
const votes = new Table('votes', { nextId: 1, votes: [] });

// Buang baris refresh yang sudah kedaluwarsa maupun dicabut. Baris yang
// dirotasi sengaja DIPERTAHANKAN: justru baris itu yang membuat penyalahgunaan
// (reuse token lama) bisa terdeteksi.
function sweepSessions() {
  const now = Date.now();
  const before = sessions.data.sessions.length;
  sessions.data.sessions = sessions.data.sessions.filter(
    (s) => s.expires > now || s.revoked_at === null,
  );
  if (sessions.data.sessions.length !== before) sessions.flush();
}

const close = () => { users.flush(); sessions.flush(); comments.flush(); votes.flush(); };

module.exports = { users, sessions, comments, votes, sweepSessions, close };