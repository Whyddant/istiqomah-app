/* Penyimpanan pribadi di HP anggota (IndexedDB).
 *
 * Dipakai untuk satu dokumen saja: foto buku besar milik anggota. Foto ini
 * tidak pernah dikirim ke server dan tidak terlihat oleh anggota lain.
 * Satu kali simpan berlaku sampai anggota itu mendapat arisan lagi dan
 * buku besarnya berubah.
 */
window.Penyimpanan = (function () {
  "use strict";

  var NAMA_DB = "al-istiqomah";
  var NAMA_TOKO = "dokumen";
  var KUNCI_BUKU = "buku-besar";

  function buka() {
    return new Promise(function (selesai, gagal) {
      if (!window.indexedDB) {
        gagal(new Error("tidak-tersedia"));
        return;
      }
      var minta;
      try {
        minta = indexedDB.open(NAMA_DB, 1);
      } catch (e) {
        gagal(new Error("tidak-tersedia"));
        return;
      }
      minta.onupgradeneeded = function () {
        minta.result.createObjectStore(NAMA_TOKO);
      };
      minta.onsuccess = function () {
        selesai(minta.result);
      };
      minta.onerror = function () {
        gagal(new Error("tidak-tersedia"));
      };
      minta.onblocked = function () {
        gagal(new Error("tidak-tersedia"));
      };
    });
  }

  /* Menjalankan satu operasi dan menunggu transaksinya benar-benar selesai. */
  function jalankan(mode, operasi) {
    return buka().then(function (db) {
      return new Promise(function (selesai, gagal) {
        var hasil;
        var trx = db.transaction(NAMA_TOKO, mode);
        var toko = trx.objectStore(NAMA_TOKO);
        var minta = operasi(toko);
        if (minta) {
          minta.onsuccess = function () {
            hasil = minta.result;
          };
        }
        trx.oncomplete = function () {
          db.close();
          selesai(hasil);
        };
        trx.onerror = trx.onabort = function () {
          db.close();
          gagal(trx.error || new Error("gagal-simpan"));
        };
      });
    });
  }

  function ambilBukuBesar() {
    return jalankan("readonly", function (toko) {
      return toko.get(KUNCI_BUKU);
    }).then(function (rekaman) {
      return rekaman || null;
    });
  }

  function simpanBukuBesar(rekaman) {
    return jalankan("readwrite", function (toko) {
      return toko.put(rekaman, KUNCI_BUKU);
    });
  }

  function hapusBukuBesar() {
    return jalankan("readwrite", function (toko) {
      return toko.delete(KUNCI_BUKU);
    });
  }

  /* Meminta peramban tidak menghapus foto saat ruang HP menipis. Boleh
   * ditolak; fotonya tetap tersimpan dan bisa difoto ulang kapan saja. */
  function mintaTetap() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persist().catch(function () {
          return false;
        });
      }
    } catch (e) {
      /* abaikan */
    }
    return Promise.resolve(false);
  }

  return {
    ambilBukuBesar: ambilBukuBesar,
    simpanBukuBesar: simpanBukuBesar,
    hapusBukuBesar: hapusBukuBesar,
    mintaTetap: mintaTetap,
  };
})();
