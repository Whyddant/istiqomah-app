/* Service worker: menyimpan "kerangka" aplikasi agar tetap terbuka tanpa sinyal.
 * Data dinamis (narik, jadwal) disimpan oleh aplikasi sendiri, bukan di sini.
 * Naikkan VERSI setiap kali file aplikasi berubah supaya HP anggota memperbarui. */
const VERSI = "al-istiqomah-v11";
const KERANGKA = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/config.js",
  "./js/tampilan.js",
  "./js/data.js",
  "./js/salat.js",
  "./js/store.js",
  "./js/admin.js",
  "./js/app.js",
  "./icons/logo-placeholder.png",
  "./icons/pola-bintang.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(VERSI)
      .then((c) => c.addAll(KERANGKA))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nama) => Promise.all(nama.filter((n) => n !== VERSI).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Hanya menangani berkas milik aplikasi sendiri. Panggilan data ke
  // Apps Script (alamat lain) dibiarkan langsung ke jaringan.
  if (url.origin !== self.location.origin) return;

  // Data contoh (data/) selalu diambil dari jaringan. Salinan cadangannya
  // disimpan oleh aplikasi sendiri, supaya info narik tidak basi.
  // Buku zikir (data/zikir) dan sejarah majelis dikecualikan: isinya jarang berubah dan harus bisa
  // dibaca tanpa sinyal, jadi diperlakukan seperti berkas lain di bawah.
  if (url.pathname.indexOf("/data/") !== -1 && url.pathname.indexOf("/data/zikir") === -1 && url.pathname.indexOf("/data/sejarah") === -1) return;

  // Halaman: coba jaringan dulu supaya versi baru cepat sampai,
  // jika gagal pakai salinan tersimpan.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const salinan = res.clone();
          caches.open(VERSI).then((c) => c.put("./index.html", salinan));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Berkas lain: pakai salinan tersimpan, perbarui di belakang layar.
  e.respondWith(
    caches.match(req).then((tersimpan) => {
      const dariJaringan = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const salinan = res.clone();
            caches.open(VERSI).then((c) => c.put(req, salinan));
          }
          return res;
        })
        .catch(() => tersimpan);
      return tersimpan || dariJaringan;
    })
  );
});
