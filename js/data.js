/* Pengambilan data bersama (info narik, kegiatan, pengumuman, banner, kajian).
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

  function barisKas(daftar) {
    return (Array.isArray(daftar) ? daftar : [])
      .map(function (k) {
        k = k && typeof k === "object" ? k : {};
        return { tanggal: teks(k.tanggal), keterangan: teks(k.keterangan), jumlah: angka(k.jumlah) };
      })
      .filter(function (k) {
        return k.keterangan && k.jumlah !== null;
      });
  }

  /* Ringkasan kas: null bila tidak ada, supaya halaman Kas tahu belum ada data. */
  function bersihkanKas(mentah) {
    if (!mentah || typeof mentah !== "object") return null;
    var saldo = angka(mentah.saldo);
    if (saldo === null) return null;
    var pk = mentah.pekan && typeof mentah.pekan === "object" ? mentah.pekan : {};
    return {
      saldo: saldo,
      pekan: {
        dari: teks(pk.dari),
        sampai: teks(pk.sampai),
        total: angka(pk.total) || 0,
        rincian: barisKas(pk.rincian),
      },
      pengeluaran: barisKas(mentah.pengeluaran),
      diperbarui: teks(mentah.diperbarui),
    };
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

    var JENIS_BANNER = ["duka", "penting", "umum"];
    var banner = (Array.isArray(d.banner) ? d.banner : [])
      .map(function (b) {
        b = b && typeof b === "object" ? b : {};
        var jenis = teks(b.jenis);
        return {
          jenis: JENIS_BANNER.indexOf(jenis) !== -1 ? jenis : "umum",
          judul: teks(b.judul),
          isi: teks(b.isi),
          sampai: teks(b.sampai),
        };
      })
      .filter(function (b) {
        return b.judul || b.isi;
      })
      .slice(0, 3);

    var kajian = (Array.isArray(d.kajian) ? d.kajian : [])
      .map(function (k) {
        k = k && typeof k === "object" ? k : {};
        return {
          jenis: teks(k.jenis),
          tanggal: teks(k.tanggal),
          judul: teks(k.judul),
          penceramah: teks(k.penceramah),
          ringkasan: teks(k.ringkasan),
        };
      })
      .filter(function (k) {
        return (k.jenis === "tausiyah" || k.jenis === "kajian") && (k.judul || k.ringkasan);
      });

    return {
      contoh: d.contoh === true,
      banner: banner,
      kajian: kajian,
      lokasiDefault: teks(d.lokasi_default),
      narik: n
        ? {
            tanggal: teks(n.tanggal),
            nama: teks(n.nama),
            noAnggota: angka(n.no_anggota),
            lokasi: teks(n.lokasi),
            waktu: teks(n.waktu),
          }
        : null,
      kas: bersihkanKas(d.kas),
      donasi: (Array.isArray(d.donasi) ? d.donasi : [])
        .map(function (x) {
          x = x && typeof x === "object" ? x : {};
          var qris = teks(x.qris_url);
          return {
            judul: teks(x.judul),
            keterangan: teks(x.keterangan),
            bank: teks(x.bank),
            nomor: typeof x.nomor === "string" || typeof x.nomor === "number" ? String(x.nomor).trim() : "",
            atasNama: teks(x.atas_nama),
            // hanya https yang dipasang sebagai gambar; selain itu diabaikan
            qrisUrl: /^https:\/\/[^\s"'<>]+$/.test(qris) ? qris : "",
            sampai: teks(x.sampai),
          };
        })
        .filter(function (x) {
          return x.judul && (x.nomor || x.qrisUrl);
        })
        .slice(0, 10),
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
        var mentah = JSON.parse(isi);
        // Skrip data menjawab { ok:false, kode, pesan } saat gagal: anggap
        // sambungan gagal supaya salinan tersimpan yang ditampilkan.
        if (mentah && mentah.ok === false) throw new Error(mentah.kode || "galat");
        var data = bersihkan(mentah);
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
