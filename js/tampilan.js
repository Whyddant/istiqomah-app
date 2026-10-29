/* Pilihan tampilan: ukuran huruf dan tema (terang/gelap).
 *
 * Dimuat di <head> sebelum gaya digambar, supaya pilihan tersimpan langsung
 * berlaku dan layar tidak berkedip dari terang ke gelap. Disimpan hanya di HP
 * ini (localStorage); bila penyimpanan dimatikan, aplikasi memakai bawaan.
 */
window.Tampilan = (function () {
  "use strict";

  var KUNCI = "al-istiqomah:tampilan";
  var UKURAN = {
    kecil: { persen: 100, nama: "Kecil" },
    sedang: { persen: 112.5, nama: "Sedang" },
    besar: { persen: 125, nama: "Besar" },
    sangat: { persen: 140, nama: "Sangat besar" },
  };
  var URUTAN_UKURAN = ["kecil", "sedang", "besar", "sangat"];
  var TEMA = { otomatis: "Ikuti HP", terang: "Terang", gelap: "Gelap" };
  var URUTAN_TEMA = ["otomatis", "terang", "gelap"];
  var BAWAAN = { ukuran: "sedang", tema: "otomatis" };

  var kini = { ukuran: BAWAAN.ukuran, tema: BAWAAN.tema };

  function baca() {
    try {
      var o = JSON.parse(localStorage.getItem(KUNCI) || "{}");
      if (o && typeof o === "object") {
        if (Object.prototype.hasOwnProperty.call(UKURAN, o.ukuran)) kini.ukuran = o.ukuran;
        if (Object.prototype.hasOwnProperty.call(TEMA, o.tema)) kini.tema = o.tema;
      }
    } catch (e) {
      /* tanpa penyimpanan: pakai bawaan */
    }
  }

  function simpan() {
    try {
      if (kini.ukuran === BAWAAN.ukuran && kini.tema === BAWAAN.tema) localStorage.removeItem(KUNCI);
      else localStorage.setItem(KUNCI, JSON.stringify(kini));
    } catch (e) {
      /* abaikan: pilihan tetap berlaku sampai halaman ditutup */
    }
  }

  function terapkan() {
    var akar = document.documentElement;
    akar.style.fontSize = UKURAN[kini.ukuran].persen + "%";
    if (kini.tema === "otomatis") akar.removeAttribute("data-theme");
    else akar.setAttribute("data-theme", kini.tema === "gelap" ? "dark" : "light"); // nilai yang dikenal styles.css
  }

  function aturUkuran(k) {
    if (!Object.prototype.hasOwnProperty.call(UKURAN, k)) return;
    kini.ukuran = k;
    simpan();
    terapkan();
  }

  function aturTema(k) {
    if (!Object.prototype.hasOwnProperty.call(TEMA, k)) return;
    kini.tema = k;
    simpan();
    terapkan();
  }

  function kembalikan() {
    kini = { ukuran: BAWAAN.ukuran, tema: BAWAAN.tema };
    simpan();
    terapkan();
  }

  baca();
  terapkan();

  return {
    ukuran: function () {
      return kini.ukuran;
    },
    tema: function () {
      return kini.tema;
    },
    aturUkuran: aturUkuran,
    aturTema: aturTema,
    kembalikan: kembalikan,
    UKURAN: UKURAN,
    URUTAN_UKURAN: URUTAN_UKURAN,
    TEMA: TEMA,
    URUTAN_TEMA: URUTAN_TEMA,
  };
})();
