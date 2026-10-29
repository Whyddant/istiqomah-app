/* Waktu salat dan arah kiblat, dihitung di HP tanpa internet.
 *
 * Rumus astronomi standar (posisi matahari, persamaan waktu, sudut jam).
 * Pengaturan mengikuti Kementerian Agama RI: sudut Subuh 20 derajat, sudut
 * Isya 18 derajat, Ashar bayangan satu kali panjang benda (mazhab Syafi'i),
 * ditambah ihtiyat (pengaman) beberapa menit. Hasilnya perkiraan: selisih
 * satu atau dua menit dengan jadwal resmi bisa terjadi, jadi patokan tetap
 * jadwal yang dipakai masjid.
 *
 * Semua fungsi murni (tanpa DOM) agar mudah diuji.
 */
window.Salat = (function () {
  "use strict";

  var RAD = Math.PI / 180;
  var KAABAH = { lintang: 21.422487, bujur: 39.826206 };

  function sin(d) { return Math.sin(d * RAD); }
  function cos(d) { return Math.cos(d * RAD); }
  function tan(d) { return Math.tan(d * RAD); }
  function acos(x) { return Math.acos(x) / RAD; }
  function atan2(y, x) { return Math.atan2(y, x) / RAD; }
  function putar(x, m) { return ((x % m) + m) % m; }

  function hariJulian(th, bl, tg) {
    if (bl <= 2) { th -= 1; bl += 12; }
    var A = Math.floor(th / 100);
    var B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (th + 4716)) + Math.floor(30.6001 * (bl + 1)) + tg + B - 1524.5;
  }

  /* Deklinasi matahari (derajat) dan persamaan waktu (jam) pada hari julian jd. */
  function posisiMatahari(jd) {
    var D = jd - 2451545.0;
    var g = putar(357.529 + 0.98560028 * D, 360);
    var q = putar(280.459 + 0.98564736 * D, 360);
    var L = putar(q + 1.915 * sin(g) + 0.02 * sin(2 * g), 360);
    var e = 23.439 - 0.00000036 * D;
    var RA = putar(atan2(cos(e) * sin(L), cos(L)), 360) / 15;
    var dekl = Math.asin(sin(e) * sin(L)) / RAD;
    var eqt = q / 15 - RA;
    if (eqt > 12) eqt -= 24;
    if (eqt < -12) eqt += 24;
    return { dekl: dekl, eqt: eqt };
  }

  function bacaIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    return m ? { th: Number(m[1]), bl: Number(m[2]), tg: Number(m[3]) } : null;
  }

  /* Selisih jam dari tengah hari sampai matahari mencapai ketinggian alt (derajat). */
  function sudutJam(alt, lintang, dekl) {
    var x = (sin(alt) - sin(lintang) * sin(dekl)) / (cos(lintang) * cos(dekl));
    if (x < -1 || x > 1) return null;
    return acos(x) / 15;
  }

  /* Waktu dalam menit sejak tengah malam (bisa pecahan), atau null bila
   * matahari tidak mencapai sudut itu (tidak terjadi di Indonesia). */
  function hitung(iso, lintang, bujur, zonaJam, opsi) {
    var t = bacaIso(iso);
    if (!t) return null;
    opsi = opsi || {};
    var sudutSubuh = opsi.sudutSubuh === undefined ? 20 : opsi.sudutSubuh;
    var sudutIsya = opsi.sudutIsya === undefined ? 18 : opsi.sudutIsya;
    var ihtiyat = opsi.ihtiyat === undefined ? 2 : opsi.ihtiyat;

    var jd = hariJulian(t.th, t.bl, t.tg) + (12 - zonaJam) / 24; // tengah hari setempat
    var p = posisiMatahari(jd);
    var dzuhur = 12 + zonaJam - bujur / 15 - p.eqt; // jam
    var ho = -0.833; // terbit/terbenam, termasuk refraksi dan jari-jari matahari
    var altAshar = Math.atan(1 / (1 + tan(Math.abs(lintang - p.dekl)))) / RAD;

    var hSubuh = sudutJam(-sudutSubuh, lintang, p.dekl);
    var hTerbit = sudutJam(ho, lintang, p.dekl);
    var hAshar = sudutJam(altAshar, lintang, p.dekl);
    var hIsya = sudutJam(-sudutIsya, lintang, p.dekl);
    if (hSubuh === null || hTerbit === null || hAshar === null || hIsya === null) return null;

    return {
      subuh: (dzuhur - hSubuh) * 60 + ihtiyat,
      terbit: (dzuhur - hTerbit) * 60 - ihtiyat,
      dzuhur: dzuhur * 60 + ihtiyat,
      ashar: (dzuhur + hAshar) * 60 + ihtiyat,
      maghrib: (dzuhur + hTerbit) * 60 + ihtiyat,
      isya: (dzuhur + hIsya) * 60 + ihtiyat,
    };
  }

  /* Dibulatkan ke menit seperti jadwal cetak: naik untuk waktu salat, turun untuk terbit. */
  function bulatkan(menit, naik) {
    return naik ? Math.ceil(menit - 1e-9) : Math.floor(menit + 1e-9);
  }

  function jadwal(iso, lintang, bujur, zonaJam, opsi) {
    var m = hitung(iso, lintang, bujur, zonaJam, opsi);
    if (!m) return null;
    return {
      subuh: bulatkan(m.subuh, true),
      terbit: bulatkan(m.terbit, false),
      dzuhur: bulatkan(m.dzuhur, true),
      ashar: bulatkan(m.ashar, true),
      maghrib: bulatkan(m.maghrib, true),
      isya: bulatkan(m.isya, true),
    };
  }

  var URUTAN = ["subuh", "terbit", "dzuhur", "ashar", "maghrib", "isya"];
  var NAMA = { subuh: "Subuh", terbit: "Terbit", dzuhur: "Dzuhur", ashar: "Ashar", maghrib: "Maghrib", isya: "Isya" };
  var WAJIB = ["subuh", "dzuhur", "ashar", "maghrib", "isya"]; // terbit bukan waktu salat

  function tambahHariIso(iso, n) {
    var t = bacaIso(iso);
    var d = new Date(Date.UTC(t.th, t.bl - 1, t.tg + n));
    return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2);
  }

  /* Salat wajib berikutnya setelah menitSekarang pada tanggal iso. Setelah Isya,
   * yang berikutnya adalah Subuh esok hari. Mengembalikan {kunci, menit, sisa, besok}. */
  function berikutnya(iso, menitSekarang, lintang, bujur, zonaJam, opsi) {
    var hariIni = jadwal(iso, lintang, bujur, zonaJam, opsi);
    if (!hariIni) return null;
    for (var i = 0; i < WAJIB.length; i++) {
      var k = WAJIB[i];
      if (hariIni[k] > menitSekarang) return { kunci: k, menit: hariIni[k], sisa: hariIni[k] - menitSekarang, besok: false };
    }
    var esok = jadwal(tambahHariIso(iso, 1), lintang, bujur, zonaJam, opsi);
    if (!esok) return null;
    return { kunci: "subuh", menit: esok.subuh, sisa: esok.subuh + 1440 - menitSekarang, besok: true };
  }

  function format(menit) {
    var m = ((menit % 1440) + 1440) % 1440;
    return ("0" + Math.floor(m / 60)).slice(-2) + "." + ("0" + (m % 60)).slice(-2);
  }

  /* Arah kiblat: sudut dari utara sejati searah jarum jam (0 sampai 360). */
  function kiblat(lintang, bujur) {
    var dl = (KAABAH.bujur - bujur);
    var y = sin(dl) * cos(KAABAH.lintang);
    var x = cos(lintang) * sin(KAABAH.lintang) - sin(lintang) * cos(KAABAH.lintang) * cos(dl);
    return putar(atan2(y, x), 360);
  }

  var MATA_ANGIN = ["utara", "timur laut", "timur", "tenggara", "selatan", "barat daya", "barat", "barat laut"];
  function mataAngin(derajat) {
    return MATA_ANGIN[Math.round(putar(derajat, 360) / 45) % 8];
  }

  /* Selisih terkecil antara dua arah, -180 sampai 180. */
  function selisihArah(a, b) {
    var d = putar(a - b, 360);
    return d > 180 ? d - 360 : d;
  }

  return {
    jadwal: jadwal,
    hitung: hitung,
    berikutnya: berikutnya,
    format: format,
    kiblat: kiblat,
    mataAngin: mataAngin,
    selisihArah: selisihArah,
    URUTAN: URUTAN,
    WAJIB: WAJIB,
    NAMA: NAMA,
    tambahHariIso: tambahHariIso,
  };
})();
