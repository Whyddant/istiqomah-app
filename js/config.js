/* Pengaturan aplikasi.
 *
 * Hanya berkas ini yang perlu diubah saat aplikasi disambungkan ke data
 * sebenarnya milik majelis (folder Google Drive yang dikelola super admin).
 */
window.KONFIG = {
  // Alamat skrip Google Apps Script milik super admin (diisi pada tahap berikutnya).
  // Selama kosong, aplikasi memakai berkas contoh di BERKAS_CONTOH.
  ALAMAT_DATA: "",

  // Data contoh untuk percobaan tampilan. Bukan data majelis yang sebenarnya.
  BERKAS_CONTOH: "data/app-data.json",

  // Batas waktu menunggu data sebelum memakai salinan tersimpan (milidetik).
  BATAS_WAKTU_DATA: 10000,
};
