/* Pengambilan data bersama (info narik, kegiatan, pengumuman).
 *
 * Satu-satunya berkas yang tahu dari mana data berasal. Nanti sumbernya
 * berpindah dari berkas contoh ke skrip Google Apps Script, tanpa mengubah
 * bagian lain aplikasi.
 *
 * Bila sambungan gagal, dipakai salinan terakhir yang pernah berhasil
 * diambil, supaya aplikasi tetap menampilkan sesuatu saat tanpa sinyal.
 */
window.Data = (function () {
  "use strict";

  var KUNCI_CADANGAN = "al-istiqomah:data";

  function teks(v) {
    return typeof v === "string" ? v.trim() : "";
  }

  function angka(v) {
    var n = Number(v);
    return v !== null && v !== "" && isFinite(n) ? n : null;
  }

  /* Merapikan data mentah menjadi bentuk yang pasti dikenali aplikasi.
   * Isi dari luar tidak dipercaya: semua nilai dicek jenisnya. */
  function bersihkan(mentah) {
    var d = mentah && typeof mentah === "object" ? mentah : {};
    var n = d.narik && typeof d.narik === "object" ? d.narik : null;

    var kegiatan = (Array.isArray(d.kegiatan) ? d.kegiatan : [])
      .map(function (k) {
        k = k && typeof k === "object" ? k : {};
        var hari = angka(k.hari);
        var interval = angka(k.interval_minggu);
        return {
          nama: teks(k.nama),
          aturan: teks(k.aturan),
          hari: hari !== null && hari >= 0 && hari <= 6 && Math.floor(hari) === hari ? hari : null,
          intervalMinggu: interval !== null && interval >= 1 ? Math.floor(interval) : 1,
          jangkar: teks(k.jangkar),
          waktu: teks(k.waktu),
          lokasi: teks(k.lokasi),
        };
      })
      .filter(function (k) {
        return k.nama;
      });

    var pengumuman = (Array.isArray(d.pengumuman) ? d.pengumuman : [])
      .map(function (p) {
        p = p && typeof p === "object" ? p : {};
        return { judul: teks(p.judul), tanggal: teks(p.tanggal), isi: teks(p.isi) };
      })
      .filter(function (p) {
        return p.judul || p.isi;
      });

    return {
      contoh: d.contoh === true,
      lokasiDefault: teks(d.lokasi_default),
      narik: n
        ? {
            tanggal: teks(n.tanggal),
            nama: teks(n.nama),
            noAnggota: angka(n.no_anggota),
            lokasi: teks(n.lokasi),
          }
        : null,
      kegiatan: kegiatan,
      pengumuman: pengumuman,
    };
  }

  function ambil() {
    var alamat = window.KONFIG.ALAMAT_DATA || window.KONFIG.BERKAS_CONTOH;
    var kendali = new AbortController();
    var penunda = setTimeout(function () {
      kendali.abort();
    }, window.KONFIG.BATAS_WAKTU_DATA);

    return fetch(alamat, { cache: "no-store", signal: kendali.signal })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (isi) {
        clearTimeout(penunda);
        return isi;
      })
      .catch(function (galat) {
        clearTimeout(penunda);
        throw galat;
      });
  }

  function simpanCadangan(isiMentah) {
    try {
      localStorage.setItem(
        KUNCI_CADANGAN,
        JSON.stringify({ waktu: new Date().toISOString(), isi: isiMentah })
      );
    } catch (e) {
      /* penyimpanan penuh atau dimatikan: aplikasi tetap jalan tanpa cadangan */
    }
  }

  function bacaCadangan() {
    try {
      var mentah = localStorage.getItem(KUNCI_CADANGAN);
      if (!mentah) return null;
      var bungkus = JSON.parse(mentah);
      return { waktu: bungkus.waktu, data: bersihkan(JSON.parse(bungkus.isi)) };
    } catch (e) {
      return null;
    }
  }

  /* Hasil: { data, dariCadangan, waktu }. Menolak (reject) hanya bila
   * sambungan gagal dan belum pernah ada salinan tersimpan. */
  function muat() {
    return ambil()
      .then(function (isi) {
        var data = bersihkan(JSON.parse(isi));
        simpanCadangan(isi);
        return { data: data, dariCadangan: false, waktu: null };
      })
      .catch(function (galat) {
        var cadangan = bacaCadangan();
        if (cadangan) {
          return { data: cadangan.data, dariCadangan: true, waktu: cadangan.waktu };
        }
        throw galat;
      });
  }

  return { muat: muat, bersihkan: bersihkan };
})();
