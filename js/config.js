/* Pengaturan aplikasi.
 *
 * Hanya berkas ini yang perlu diubah saat aplikasi disambungkan ke data
 * sebenarnya milik majelis (folder Google Drive yang dikelola super admin).
 */
window.KONFIG = {
  // Alamat skrip Google Apps Script milik super admin (diisi pada tahap berikutnya).
  // Selama kosong, aplikasi memakai berkas contoh di BERKAS_CONTOH.
  ALAMAT_DATA: "",

  // ID klien OAuth Google (jenis "Web application") untuk tombol masuk pengurus.
  // Nilainya bukan rahasia. Alamat aplikasi harus terdaftar sebagai
  // "Authorized JavaScript origin" di Google Cloud Console. Selama kosong,
  // bagian pengurus menampilkan petunjuk dan bagian lain tetap jalan.
  GOOGLE_CLIENT_ID: "",

  // Data contoh untuk percobaan tampilan. Bukan data majelis yang sebenarnya.
  BERKAS_CONTOH: "data/app-data.json",

  // Batas waktu menunggu data sebelum memakai salinan tersimpan (milidetik).
  BATAS_WAKTU_DATA: 10000,
  BERKAS_ZIKIR: "data/zikir.json",

  // Lokasi masjid untuk waktu salat dan arah kiblat. Nilai di bawah adalah titik
  // Bojongsari, Depok (perkiraan). Ganti dengan koordinat masjid yang tepat:
  // di Google Maps tekan lama pada masjid, lalu salin dua angka koordinatnya.
  // Selisih beberapa ratus meter tidak berpengaruh pada waktu salat.
  KOORDINAT: { lintang: -6.397, bujur: 106.739 },
  ZONA_NAMA: "Asia/Jakarta",
  ZONA_JAM: 7, // WIB = UTC+7
  IHTIYAT_MENIT: 2, // pengaman waktu salat, seperti jadwal Kemenag RI

  // Tautan media sosial di kaki halaman. Isi alamat lengkap diawali https://
  // (mis. "https://www.instagram.com/akun_majelis"). Yang kosong tidak ditampilkan.
  SOSMED: { youtube: "", instagram: "", facebook: "" },

  // Nama pengembang di kaki halaman.
  PENGEMBANG: "Yudi Danton",
};
