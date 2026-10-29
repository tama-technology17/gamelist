# GameList

Katalog game free-to-play (HTML, CSS, JavaScript vanilla dengan ES Modules) yang mengambil data langsung dari [FreeToGame API](https://www.freetogame.com/api-doc). Data oleh FreeToGame.com (atribusi wajib, sudah ada di footer). Dilengkapi akun pengguna, profil, dan foto profil.

## Menjalankan

```bash
npm install        # sekali saja, untuk mengunduh bcryptjs
node server.js     # buka http://localhost:8080/?api=/api
```

Node 18+. Server menyajikan file statis, meneruskan `/api/games` dan `/api/game` ke FreeToGame (agar tidak terkena CORS), **dan** melayani API akun di `/api/auth/*` serta `/api/me*`. Pilihan `?api=/api` tersimpan di browser; pakai `?api=` (kosong) untuk kembali ke API langsung.

**Penting:** fitur akun hanya jalan di `node server.js`. Kalau memakai `python -m http.server`, katalog tetap berfungsi tetapi halaman masuk akan memberi tahu bahwa server tidak melayani API akun.

## Komentar

Setiap game punya bagian komentar di halaman detail.

- **Isi komentar hanya teks dan emoji** (maks 600 karakter). Tidak ada tautan, gambar, atau HTML — teks dirender lewat `textContent` dan URL tidak pernah jadi tautan.
- **Boleh anonim.** Tanpa akun cukup isi nama (2–24 karakter). Dengan akun, nama diambil otomatis dari profil dan tidak bisa dispoof.
- **Akses:** hanya pemilik komentar yang bisa mengubah atau menghapusnya; hanya pengguna terdaftar yang bisa menekan suka. Komentar anonim tidak punya tombol edit/hapus.
- **Fitur:** picker emoji (6 kategori + pencarian + riwayat pakai, 153 emoji), penghitung karakter, waktu relatif ("2 jam lalu") yang menyegarkan sendiri, sortir (Terbaru / Terlama / Paling disukai), suka dengan toggle, dan efeksorotan untuk komentar baru.
- **Penyimpanan:** `data/comments.json`, ditulis atomik. Maksimal 300 komentar per game; yang terlama otomatis dibuang.
- **Anti-spam:** rate limit per IP+user untuk posting. Request yang tidak valid **tidak** menghabiskan kuota.

## Fungsi file

| File | Fungsi |
|---|---|
| `index.html` | Kerangka halaman: navbar, area konten, footer, toast, progress scroll, curtain pembuka, blokir tema awal |
| `style.css` | Token warna, dark/light theme, skeleton, halaman akun & komentar, responsivitas |
| `app.js` | Inisialisasi, state, render halaman, favorit, filter, event global, tema, animasi, akun, komentar |
| `api.js` | Semua request ke FreeToGame, cache (memori + sessionStorage), error handling |
| `account.js` | Klien API akun (browser). Selalu same-origin, tidak memakai `BASE` dari `api.js` |
| `comment.js` | Klien API komentar + dataset emoji (browser). Sama: selalu same-origin |
| `router.js` | Hash routing: `#/`, `#/games?...`, `#/game/ID`, `#/favorites`, `#/profil`, `#/masuk`, `#/daftar` |
| `components.js` | Card, hero, detail, skeleton, error/empty state, toast, form akun, panel profil, section komentar |
| `utils.js` | DOM builder aman (tanpa innerHTML untuk data API), gambar, debounce, format, storage, ikon |
| `server.js` | **Server only.** File statis, proxy FreeToGame, API akun, API komentar, API suara, upload avatar |
| `jwt.js` | **Server only.** Tanda tangan & verifikasi HS256 (tanpa dependensi) |
| `auth.js` | **Server only.** Hash password, access/refresh token, rotasi, cookie, validasi, rate limit, deteksi format gambar |
| `comments.js` | **Server only.** Validasi & penyimpanan komentar |
| `db.js` | **Server only.** Penyimpanan JSON: muat ke memori, tulis atomik, sweep sesi kedaluwarsa |

Folder `data/` (database JSON) dan `uploads/` (foto profil) dibuat otomatis saat pertama jalan, dan tidak boleh di-commit.

## Akun & profil

- **Daftar** dengan username (3-20 karakter: huruf, angka, garis bawah) dan kata sandi minimal 8 karakter. Tidak ada verifikasi email.
- **Sesi** lewat dua cookie `HttpOnly`: access token JWT (15 menit) dan refresh token opaque (30 hari) yang dirotasi tiap kali dipakai. Keduanya `SameSite=Lax`; refresh cookie dibatasi ke path `/api/auth`.
- **Kata sandi** di-hash dengan bcrypt cost 12. Password tidak pernah disimpan atau dikirim dalam bentuk apa pun; respons selalu lewat `publicUser()`.
- **Profil**: nama tampilan, bio (maks 280 karakter), dan foto profil.
- **Foto profil** dikirim sebagai byte mentah (bukan multipart/base64), maksimal 2 MB, hanya PNG/JPEG/WebP — format ditentukan lewat magic bytes, bukan `Content-Type` dari browser. SVG ditolak karena bisa berisi skrip. Berkas disimpan sebagai `uploads/u<id>-<waktu>.<ext>`.
- **Favorit tersinkron.** Begitu kamu masuk, favorit lama di browser dimigrasikan ke akun sekali (penggabungan based on id, aman dipanggil ulang). Setelah itu server jadi sumber kebenaran; `localStorage` tetap jadi cache.

## Token & sesi

Sesi memakai kombinasi **access token JWT berumur pendek** + **refresh token opaque yang dirotasi**. Alasannya: kalau keduanya JWT, satu-satunya cara mencabut token adalah denylist — artinya JWT justru *lebih lemah* dari token server-side yang bisa dicabut seketika. Kombinasi ini memberi dua-keuntungan sekaligus.

| | Access token | Refresh token |
|---|---|---|
| Bentuk | JWT HS256 | string acak 48 byte |
| Cookie | `gl_at` | `gl_rt` |
| Umur | 15 menit | 30 hari |
| Path cookie | `/` | `/api/auth` saja |
| Disimpan di | tidak ada (stateless) | SHA-256 hash di `data/sessions.json` |
| Bisa dicabut | lewat `fid` (lihat bawah) | ya, langsung |

- **Penukaran otomatis.** Saat endpoint apa pun membalas 401 karena access token basi, klien diam-diam menukar refresh token **sekali** lalu mengulang request aslinya. Beberapa request 401 yang datang bersamaan hanya memicu satu penukaran.
- **Rotasi refresh token.** Setiap penukaran menerbitkan refresh token baru dan membatalkan yang lama.
- **Deteksi penyalahgunaan.** Bila refresh token yang *sudah pernah dirotasi* dipakai lagi, itu berarti ada dua pihak yang memegang token sama (indikasi token dicuri). Server langsung membatalkan **seluruh rantai rotasi** milik sesi itu, jadi pencuri dan pemilik asli sama-sama logout.
- **Logout berlaku seketika.** Access token JWTadillo membawa klaim `fid` (family id). Begitu rantai rotasi dicabut, token access langsung ditolak — tidak menunggu 15 menit sampai kedaluwarsa.
- **Tidak ada token di JavaScript.** Kedua cookie `HttpOnly`, jadi JS tidak pernah menyentuhnya. Token juga tidak pernah muncul di body respons JSON.
- **Rahasia JWT** disimpan di `data/secret.key` (mode 0600), dibuat otomatis saat pertama jalan. Boleh dioverride dengan env `JWT_SECRET` (minimal 32 karakter).

### Variabel lingkungan

| Variabel | Default | Guna |
|---|---|---|
| `PORT` | `8080` | Port server |
| `ACCESS_TTL_SEC` | `900` (15 menit) | Umur access token |
| `REFRESH_TTL_SEC` | `2592000` (30 hari) | Umur refresh token |
| `JWT_SECRET` | dibuat otomatis | Rahasia penandatangan JWT |
| `AUTH_MAX_ATTEMPTS` | `8` | Percobaan login/daftar per IP |
| `AUTH_WINDOW_MS` | `900000` (15 menit) | Panjang jendela rate limit |

Rate limit disimpan di memori, jadi me-restart server akan meresetnya.

## Antarmuka

- **Tema gelap/terang.** Tombol di kanan navbar. Pilihan disimpan di `localStorage` (`gamelist:theme`) dan mengikuti `prefers-color-scheme` saat pertama dibuka. `index.html` menerapkan tema sebelum render agar tidak ada kedipan.
- **Navbar kiri ke kanan.** Brand → menu (Beranda, Katalog, Favorit) → slot akun (Masuk/Daftar atau chip avatar), tombol tema, dan burger di kanan. Item aktif ditandai garis bawah.
- **Katalog.** Pencarian ter-debounce dengan tombol hapus dan hint `/`; platform, kategori (tag), genre, dan urutan tersimpan di URL. Urutan memakai segmented control. Filter aktif tampil sebagai chip yang bisa dihapus satu per satu atau sekaligus. Di layar kecil semua filter dilipat di balik tombol "Filter".
- **Tombol atas** muncul setelah scroll 600px; progress bar di bawah navbar menunjukkan posisi scroll.
- **Pintasan keyboard.** `/` fokus ke pencarian, `Esc` menutup menu atau mengosongkan pencarian, fokus selalu terlihat.

### Animasi

- **Pembuka (sekali per sesi).** Curtain dengan logo GameList, lalu konten beranda naik berurutan. Ditenukan penanda `gamelist:seen` di `sessionStorage`. Curtain, stagger, dan blur hero semuanya dilewati bila `prefers-reduced-motion` aktif.
- **Saat scroll.** Hero memakai parallax plus fade; setiap section naik saat masuk viewport; kartu muncul beruntun (jeda per kolom); kartu punya sheen yang mengikuti kursor.
- **Antar halaman.** Konten baru selalu masuk dengan animasi naik berurutan.

Semua teks antarmuka dalam bahasa Indonesia.

## Keterbatasan API FreeToGame

- Tidak ada pencarian judul: pencarian dilakukan lokal pada data yang sudah dimuat.
- Tidak ada pagination: "Muat lebih banyak" memotong secara lokal.
- `platform` bernilai `windows`, `browser`, atau `all`.
- `sort-by` bernilai `popularity`, `release-date`, `alphabetical`, atau `relevance`.
- `category` menerima genre atau tag (daftar tag ada di `api.js`). Filter "Genre" di aplikasi bersifat lokal dari field `genre`.
- Batas wajar 10 request per detik. Aplikasi men-cache respons agar request tidak berulang.

## Troubleshooting

- **"Server ini tidak melayani API akun"**: kamu memakai server statis biasa. Jalankan `node server.js`.
- **"Tidak dapat menghubungi FreeToGame API":** biasanya CORS atau koneksi. Jalankan `node server.js` dan buka dengan `?api=/api`.
- **Semua request 404 setelah pakai `?api=/api`:** kamu beralih ke server statis biasa. Buka `/?api=` sekali untuk mereset.
- **Halaman kosong atau error module:** kamu membuka `index.html` langsung. Gunakan server lokal.
- **Terlalu banyak percobaan (429):** rate limit login/daftar. Tunggu 15 menit, setel `AUTH_MAX_ATTEMPTS`, atau restart server.
- **Data lama tersangkut:** cache API hanya berlaku per tab (`sessionStorage`); tutup tab atau `sessionStorage.clear()`.
- **`npm install` gagal:** `bcryptjs` diambil dari npm registry, jadi butuh koneksi saat pertama setup.
- **Mulai dari nol:** hapus `data/` dan `uploads/`, lalu restart server.

## Checklist pengujian

- [ ] Daftar akun baru, lalu masuk lagi dengan akun tersebut
- [ ] Foto profil terunggah, tampil di navbar dan halaman profil; ganti dan hapus juga berfungsi
- [ ] Komentar tanpa akun bisa dikirim (wajib nama), dan tidak punya tombol Ubah/Hapus
- [ ] Komentar milik sendiri bisa diubah (muncul penanda "diubah") dan dihapus
- [ ] Picker emoji: semua kategori, pencarian, riwayat pakai, dan `Esc` menutup panel
- [ ] Komentar kosong / terlalu panjang ditolak; character counter akurat
- [ ] Suka hanya satu per akun, dan melepas suka tidak mengikatkan kode orang lain
- [ ] Sortir "Paling disukai" mengurutkan sesuai jumlah suka
- [ ] `data/comments.json` tidak bisa diakses lewat browser (404)
- [ ] Username/password salah ditolak dengan pesan yang sama (tidak membocorkan username mana yang ada)
- [ ] `db.js`, `auth.js`, `server.js`, `package.json`, `data/users.json` semuanya 404 lewat browser
- [ ] `data/users.json` berisi hash bcrypt, tidak ada password plaintext
- [ ] Login mengirim dua cookie: access (JWT 15 menit) + refresh (30 hari, path `/api/auth`), keduanya `HttpOnly`
- [ ] Refresh token yang sudah dipakai tidak bisa dipakai lagi; memakainya ulang memutus seluruh sesi
- [ ] Setelah logout, access token langsung ditolak (tidak menunggu 15 menit)
- [ ] `data/secret.key` dan `data/sessions.json` selalu 404 lewat browser
- [ ] Tab yang ditinggal lama lalu diaktifkan kembali tetap login (refresh otomatis saat `visibilitychange`)
- [ ] Favorit yang dibuat sebelum login ikut muncul setelah masuk, lalu tetap ada setelah logout-masuk
- [ ] Beranda memuat hero, kategori, game populer, dan rilis terbaru dari API
- [ ] Katalog: filter platform, kategori, genre, dan urutan bekerja, termasuk bersama pencarian
- [ ] Chip filter aktif sesuai URL; menghapus satu chip tidak merusak nilai `<select>` atau tombol urutan
- [ ] Animasi pembuka muncul sekali per sesi (`sessionStorage.clear()` untuk mengulang)
- [ ] Tampilan rapi di lebar 360px, 768px, dan 1280px; gambar rusak jatuh ke placeholder
- [ ] Dengan `prefers-reduced-motion: reduce`, curtain tidak muncul dan semua konten langsung terlihat