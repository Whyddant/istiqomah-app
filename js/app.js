/* Majelis Taklim Al-Istiqomah — logika aplikasi, tahap 1.
 *
 * Isi tahap ini: Beranda (banner info penting, kartu narik malam Jumat,
 * kegiatan berikutnya, cuplikan kajian terbaru, pengumuman), halaman Kas, halaman Arisan (foto lembar omzet pribadi di HP anggota), dan
 * penampil foto layar penuh. Kas, Ibadah, dan Info masih halaman persiapan.
 *
 * Aturan yang dipegang:
 *  - Aplikasi tidak membaca nominal dari lembar omzet. Foto hanya disimpan di
 *    HP anggota dan dibuka oleh anggota itu sendiri.
 *  - Semua teks dari data dipasang lewat textContent, tidak pernah innerHTML.
 */
(function () {
  "use strict";

  var NAMA_APLIKASI = "Majelis Taklim Al-Istiqomah";
  var RUTE = ["beranda", "arisan", "kas", "ibadah", "info", "pengurus", "pengaturan", "sejarah", "tentang"];
  var JUDUL = { beranda: "Beranda", arisan: "Arisan", kas: "Kas", ibadah: "Ibadah", info: "Info", pengurus: "Pengurus", pengaturan: "Pengaturan", sejarah: "Sejarah", tentang: "Tentang aplikasi" };

  /* ---------- Keadaan ---------- */
  var keadaan = {
    muat: "memuat", // memuat | siap | gagal
    data: null,
    dariCadangan: false,
    waktuCadangan: null,
    buku: null, // rekaman foto lembar omzet dari IndexedDB, atau null
    bukuUrl: null, // alamat sementara untuk menampilkan foto
    bukuTersedia: true, // false bila HP tidak mengizinkan penyimpanan
    konfirmasiHapus: false,
    kompas: { aktif: false, arah: null, status: "" }, // arah HP (derajat dari utara) bila kompas dinyalakan
    sub: "", // sub-halaman, mis. "tahlil" pada #ibadah/tahlil
    zikir: { status: "idle", daftar: [] }, // daftar buku zikir
    zikirBuku: { id: "", status: "idle", isi: null }, // buku zikir yang sedang dibaca
    baca: { ukuran: 2, latin: false, arti: true }, // pilihan tampilan baca (tersimpan di HP)
    kajianTerbuka: {}, // {tausiyah:true, kajian:true} ringkasan yang dibuka penuh
    petaPasang: null, // peristiwa beforeinstallprompt yang ditahan
  };
  var ruteSekarang = "beranda";
  var sudahMulai = false;

  /* ---------- Alat kecil ---------- */
  function $(selektor) {
    return document.querySelector(selektor);
  }

  function tambah(induk, anak) {
    for (var i = 0; i < anak.length; i++) {
      var a = anak[i];
      if (a === null || a === undefined || a === false) continue;
      if (Array.isArray(a)) tambah(induk, a);
      else induk.append(a);
    }
  }

  /* Membuat elemen. sifat: class, teks, on:{peristiwa:fungsi}, atau atribut biasa. */
  function h(tag, sifat) {
    var el = document.createElement(tag);
    if (sifat) {
      Object.keys(sifat).forEach(function (k) {
        var v = sifat[k];
        if (v === undefined || v === null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "teks") el.textContent = v;
        else if (k === "on") {
          Object.keys(v).forEach(function (e) {
            el.addEventListener(e, v[e]);
          });
        } else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    tambah(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }

  /* Ikon tetap (bukan dari data), aman dipasang lewat innerHTML. */
  var IKON = {
    kas:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h14a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M4 7.5 15 4v3.5"/><circle cx="16.2" cy="13.8" r="1.1"/></svg>',
    ibadah:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13C17 4 14 4.5 12 6z"/><path d="M12 6v13"/></svg>',
    info:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>',
  };

  function ikon(nama) {
    var pembungkus = document.createElement("span");
    pembungkus.innerHTML = IKON[nama] || "";
    return pembungkus.firstChild;
  }

  /* ---------- Tanggal (jam 12 siang agar tidak bergeser oleh zona waktu) ---------- */
  var fmtLengkap = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  var fmtBulanPendek = new Intl.DateTimeFormat("id-ID", { month: "short" });
  var fmtHariPendek = new Intl.DateTimeFormat("id-ID", { weekday: "short" });
  var fmtHariPanjang = new Intl.DateTimeFormat("id-ID", { weekday: "long" });
  var fmtTanggalPendek = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" });

  function awalHari(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  }

  function bacaTanggal(teks) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(teks || ""));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return d.getMonth() === Number(m[2]) - 1 ? d : null;
  }

  function isoTanggal(d) {
    var bln = String(d.getMonth() + 1).padStart(2, "0");
    var tgl = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + bln + "-" + tgl;
  }

  function selisihHari(a, b) {
    return Math.round((a - b) / 86400000);
  }

  function labelHari(n) {
    if (n === 0) return "Hari ini";
    if (n === 1) return "Besok";
    if (n > 1) return n + " hari lagi";
    return "";
  }

  /* Tanggal berikutnya untuk kegiatan rutin. Kegiatan yang tidak tiap minggu
   * butuh tanggal acuan (jangkar); tanpa itu tanggalnya belum bisa dihitung. */
  function tanggalBerikut(k, hariIni) {
    if (k.hari === null) return null;
    var d = new Date(hariIni);
    d.setDate(d.getDate() + ((k.hari - d.getDay() + 7) % 7));
    if (k.intervalMinggu > 1) {
      var jangkar = bacaTanggal(k.jangkar);
      if (!jangkar || jangkar.getDay() !== k.hari) return null;
      var periode = k.intervalMinggu * 7;
      var sisa = ((selisihHari(d, jangkar) % periode) + periode) % periode;
      if (sisa) d.setDate(d.getDate() + periode - sisa);
    }
    return d;
  }

  /* ---------- Info narik yang masih berlaku ---------- */
  function narikBerlaku() {
    if (!keadaan.data || !keadaan.data.narik) return null;
    var n = keadaan.data.narik;
    var tgl = bacaTanggal(n.tanggal);
    if (!n.nama || !tgl) return null;
    var sisa = selisihHari(tgl, awalHari(new Date()));
    if (sisa < 0) return null;
    return { nama: n.nama, noAnggota: n.noAnggota, lokasi: n.lokasi, waktu: n.waktu, tanggal: tgl, sisa: sisa };
  }

  function teksPetunjuk(n) {
    if (n.noAnggota !== null) {
      return "Cek baris no. " + n.noAnggota + " di lembar omzet Anda untuk melihat nominal.";
    }
    return "Cek baris atas nama " + n.nama + " di lembar omzet Anda untuk melihat nominal.";
  }

  /* ---------- Pemberitahuan singkat ---------- */
  var penundaToast = null;
  function toast(pesan) {
    var el = $("#toast");
    el.textContent = pesan;
    el.hidden = false;
    clearTimeout(penundaToast);
    penundaToast = setTimeout(function () {
      el.hidden = true;
    }, 3800);
  }

  /* ---------- Foto lembar omzet: simpan di HP ---------- */
  function memuatGambar(berkas) {
    return new Promise(function (selesai, gagal) {
      var alamat = URL.createObjectURL(berkas);
      var gambar = new Image();
      gambar.onload = function () {
        URL.revokeObjectURL(alamat);
        selesai(gambar);
      };
      gambar.onerror = function () {
        URL.revokeObjectURL(alamat);
        gagal(new Error("tidak-terbaca"));
      };
      gambar.src = alamat;
    });
  }

  /* Mengecilkan foto agar hemat ruang HP tapi tulisan tetap terbaca. */
  function siapkanFoto(berkas) {
    var SISI_MAKS = 2400;
    var MUTU = 0.86;

    var sumber;
    if (window.createImageBitmap) {
      sumber = createImageBitmap(berkas, { imageOrientation: "from-image" }).catch(function () {
        return memuatGambar(berkas);
      });
    } else {
      sumber = memuatGambar(berkas);
    }

    return sumber.then(function (gambar) {
      var lebar = gambar.width || gambar.naturalWidth;
      var tinggi = gambar.height || gambar.naturalHeight;
      if (!lebar || !tinggi) throw new Error("tidak-terbaca");
      var skala = Math.min(1, SISI_MAKS / Math.max(lebar, tinggi));
      var kanvas = document.createElement("canvas");
      kanvas.width = Math.round(lebar * skala);
      kanvas.height = Math.round(tinggi * skala);
      kanvas.getContext("2d").drawImage(gambar, 0, 0, kanvas.width, kanvas.height);
      if (gambar.close) gambar.close();
      return new Promise(function (selesai, gagal) {
        kanvas.toBlob(
          function (blob) {
            if (blob) selesai({ blob: blob, lebar: kanvas.width, tinggi: kanvas.height });
            else gagal(new Error("tidak-terbaca"));
          },
          "image/jpeg",
          MUTU
        );
      });
    });
  }

  function segarkanBukuUrl() {
    if (keadaan.bukuUrl) {
      URL.revokeObjectURL(keadaan.bukuUrl);
      keadaan.bukuUrl = null;
    }
    if (keadaan.buku && keadaan.buku.blob) {
      keadaan.bukuUrl = URL.createObjectURL(keadaan.buku.blob);
    }
  }

  function muatBuku() {
    return window.Penyimpanan.ambilBukuBesar().then(
      function (rekaman) {
        keadaan.buku = rekaman;
        keadaan.bukuTersedia = true;
        segarkanBukuUrl();
      },
      function () {
        keadaan.buku = null;
        keadaan.bukuTersedia = false;
      }
    );
  }

  function pilihFoto() {
    var masukan = $("#berkas-foto");
    masukan.value = "";
    masukan.click();
  }

  function pesanGalatFoto(galat) {
    if (galat && galat.message === "tidak-terbaca") {
      return "Foto tidak bisa dibaca. Coba pilih foto lain.";
    }
    return "Foto belum tersimpan. Coba lagi, dan pastikan HP masih punya ruang kosong.";
  }

  function simpanFotoTerpilih() {
    var masukan = $("#berkas-foto");
    var berkas = masukan.files && masukan.files[0];
    if (!berkas) return;
    if (berkas.type && berkas.type.indexOf("image/") !== 0) {
      toast("Pilih berkas foto (JPG atau PNG).");
      masukan.value = "";
      return;
    }
    toast("Menyimpan foto...");
    siapkanFoto(berkas)
      .then(function (hasil) {
        var rekaman = {
          blob: hasil.blob,
          lebar: hasil.lebar,
          tinggi: hasil.tinggi,
          disimpan: new Date().toISOString(),
        };
        return window.Penyimpanan.simpanBukuBesar(rekaman).then(function () {
          keadaan.buku = rekaman;
          keadaan.bukuTersedia = true;
          segarkanBukuUrl();
          window.Penyimpanan.mintaTetap();
          tampil(false);
          toast("Lembar omzet tersimpan di HP ini.");
        });
      })
      .catch(function (galat) {
        toast(pesanGalatFoto(galat));
      })
      .then(function () {
        masukan.value = "";
      });
  }

  function hapusFoto() {
    window.Penyimpanan.hapusBukuBesar().then(
      function () {
        keadaan.buku = null;
        keadaan.konfirmasiHapus = false;
        segarkanBukuUrl();
        tampil(false);
        toast("Foto dihapus dari HP ini.");
      },
      function () {
        toast("Foto belum bisa dihapus. Coba lagi.");
      }
    );
  }

  /* ---------- Layar: Beranda ---------- */
  function salam() {
    return h(
      "div",
      { class: "salam" },
      h("p", { class: "salam-arab", lang: "ar", dir: "rtl", teks: "السَّلَامُ عَلَيْكُمْ" }),
      h("p", { class: "salam-teks", teks: "Assalamu'alaikum" }),
      h("p", { class: "salam-tanggal", teks: fmtLengkap.format(new Date()) })
    );
  }

  function kartuKosong(pesan, tombol) {
    return h(
      "article",
      { class: "narik narik-kosong", "aria-labelledby": "narik-judul" },
      h("h2", { class: "narik-judul", id: "narik-judul", teks: "Narik malam Jumat" }),
      h("p", { teks: pesan }),
      tombol
    );
  }

  function kartuNarik() {
    if (keadaan.muat === "memuat") {
      return kartuKosong("Memuat info narik...");
    }
    if (keadaan.muat === "gagal") {
      return kartuKosong(
        "Info narik belum bisa dimuat. Cek sambungan internet, lalu coba lagi.",
        h(
          "button",
          {
            type: "button",
            class: "tombol tombol-terang tombol-penuh",
            style: "margin-top:1rem",
            on: { click: muatData },
          },
          "Coba lagi"
        )
      );
    }

    var n = narikBerlaku();
    if (!n) {
      var ada = keadaan.data && keadaan.data.narik && keadaan.data.narik.nama;
      return kartuKosong(
        ada
          ? "Jadwal narik terakhir sudah lewat. Pengurus arisan belum memperbaruinya."
          : "Belum ada jadwal narik. Pengurus arisan akan mengisinya."
      );
    }

    var lokasiDefault = keadaan.data.lokasiDefault;
    var lokasi = n.lokasi || lokasiDefault;
    var lokasiDiganti = !!n.lokasi && n.lokasi !== lokasiDefault;
    var sisaLabel = labelHari(n.sisa);

    var tombol = keadaan.buku
      ? h(
          "button",
          {
            type: "button",
            id: "btn-buku",
            class: "tombol tombol-terang tombol-penuh",
            on: {
              click: function () {
                bukaPenampil();
              },
            },
          },
          "Buka lembar omzet saya"
        )
      : h(
          "button",
          {
            type: "button",
            id: "btn-buku",
            class: "tombol tombol-terang tombol-penuh",
            on: {
              click: function () {
                location.hash = "#arisan";
              },
            },
          },
          "Simpan lembar omzet saya"
        );

    return h(
      "article",
      { class: "narik", "aria-labelledby": "narik-judul" },
      h("h2", { class: "narik-judul", id: "narik-judul", teks: "Narik malam Jumat" }),
      h(
        "p",
        { class: "narik-tanggal" },
        h("time", { datetime: isoTanggal(n.tanggal), teks: fmtLengkap.format(n.tanggal) }),
        n.waktu ? h("span", { class: "narik-waktu", teks: ", " + n.waktu }) : null,
        sisaLabel ? " " : null,
        sisaLabel ? h("span", { class: "kegiatan-hariini", teks: sisaLabel }) : null
      ),
      h(
        "div",
        { class: "narik-orang" },
        h("p", { class: "narik-nama", teks: n.nama }),
        n.noAnggota !== null
          ? h(
              "div",
              { class: "narik-nomor", role: "group", "aria-label": "Nomor anggota " + n.noAnggota },
              h("span", { class: "narik-nomor-angka", teks: String(n.noAnggota) }),
              h("span", { class: "narik-nomor-label", teks: "Nomor" })
            )
          : null
      ),
      lokasi
        ? h(
            "div",
            { class: "narik-lokasi" },
            h("p", { class: "narik-lokasi-label", teks: "Lokasi" }),
            h("p", { class: "narik-lokasi-isi", teks: lokasi }),
            lokasiDiganti ? h("span", { class: "narik-lokasi-ubah", teks: "Lokasi diganti sesuai permintaan" }) : null
          )
        : null,
      h("p", { class: "narik-petunjuk", teks: teksPetunjuk(n) }),
      !keadaan.buku
        ? h("p", {
            class: "narik-petunjuk",
            teks: keadaan.bukuTersedia
              ? "Lembar omzet Anda belum disimpan di HP ini. Simpan satu kali, dipakai sampai giliran Anda berikutnya."
              : "HP ini tidak mengizinkan penyimpanan foto. Buka aplikasi di jendela biasa, bukan mode pribadi.",
          })
        : null,
      keadaan.bukuTersedia ? tombol : null
    );
  }

  function daftarKegiatan() {
    var hariIni = awalHari(new Date());
    var butir = keadaan.data.kegiatan.map(function (k) {
      return { k: k, tgl: tanggalBerikut(k, hariIni) };
    });
    butir.sort(function (a, b) {
      if (a.tgl && b.tgl) return a.tgl - b.tgl;
      if (a.tgl) return -1;
      if (b.tgl) return 1;
      return 0;
    });

    if (!butir.length) {
      return h("p", { class: "catatan", teks: "Belum ada kegiatan terjadwal." });
    }

    return h(
      "ul",
      { class: "daftar" },
      butir.map(function (b) {
        var k = b.k;
        var sisa = b.tgl ? selisihHari(b.tgl, hariIni) : null;
        var label = sisa !== null && sisa <= 1 ? labelHari(sisa) : "";
        var rincian = [];
        if (b.tgl) rincian.push(fmtLengkap.format(b.tgl));
        if (k.waktu) rincian.push(k.waktu);
        if (k.lokasi) rincian.push(k.lokasi);

        var kolomTanggal = b.tgl
          ? h(
              "div",
              { class: "kegiatan-tgl", "aria-hidden": "true" },
              h("div", { class: "kegiatan-hari", teks: String(b.tgl.getDate()) }),
              h("div", { class: "kegiatan-bulan", teks: fmtBulanPendek.format(b.tgl) })
            )
          : h(
              "div",
              { class: "kegiatan-tgl", "aria-hidden": "true" },
              h("div", {
                class: "kegiatan-hari",
                teks: k.hari !== null ? fmtHariPendek.format(new Date(2026, 0, 4 + k.hari, 12)) : "-",
              }),
              h("div", { class: "kegiatan-bulan", teks: "rutin" })
            );

        return h(
          "li",
          null,
          h(
            "div",
            { class: "kegiatan" },
            kolomTanggal,
            h(
              "div",
              { class: "kegiatan-teks" },
              h(
                "p",
                { class: "kegiatan-nama" },
                k.nama,
                label ? h("span", { class: "kegiatan-hariini", teks: label }) : null
              ),
              rincian.length ? h("p", { class: "kegiatan-ket", teks: rincian.join(", ") }) : null,
              k.aturan ? h("p", { class: "kegiatan-ket", teks: k.aturan }) : null,
              !b.tgl && k.intervalMinggu > 1
                ? h("p", { class: "kegiatan-ket", teks: "Tanggal berikutnya belum diisi pengurus." })
                : null
            )
          )
        );
      })
    );
  }

  function daftarPengumuman() {
    var p = keadaan.data.pengumuman;
    if (!p.length) return h("p", { class: "catatan", teks: "Belum ada pengumuman." });
    return h(
      "ul",
      { class: "daftar" },
      p.map(function (a) {
        var tgl = bacaTanggal(a.tanggal);
        return h(
          "li",
          { class: "kabar" },
          a.judul ? h("p", { class: "kabar-judul", teks: a.judul }) : null,
          tgl ? h("p", { class: "kabar-tanggal", teks: fmtTanggalPendek.format(tgl) }) : null,
          a.isi ? h("p", { class: "kabar-isi", teks: a.isi }) : null
        );
      })
    );
  }

  /* ---------- Banner info penting ---------- */
  var JUDUL_BANNER = { duka: "Kabar duka", penting: "Info penting", umum: "Pemberitahuan" };

  /* Banner yang masih tayang. Data tersimpan di HP bisa sudah basi, jadi
   * tanggal berakhir diperiksa lagi di sini. */
  function bannerAktif() {
    if (!keadaan.data) return [];
    var hariIni = awalHari(new Date());
    return keadaan.data.banner.filter(function (b) {
      if (!b.sampai) return true;
      var tgl = bacaTanggal(b.sampai);
      return !tgl || selisihHari(tgl, hariIni) >= 0;
    });
  }

  function bannerInfo() {
    var daftar = bannerAktif();
    if (!daftar.length) return null;
    return h(
      "section",
      { class: "banner-wadah", "aria-label": "Info penting" },
      daftar.map(function (b) {
        var duka = b.jenis === "duka";
        return h(
          "article",
          { class: "banner banner-" + b.jenis, role: b.jenis === "umum" ? null : "note" },
          h("p", { class: "banner-label", teks: JUDUL_BANNER[b.jenis] }),
          duka
            ? h("p", { class: "banner-salam", teks: "Innalillahi wa inna ilaihi raji'un" })
            : null,
          b.judul ? h("h2", { class: "banner-judul", teks: b.judul }) : null,
          b.isi ? h("p", { class: "banner-isi", teks: b.isi }) : null
        );
      })
    );
  }

  /* ---------- Cuplikan kajian terbaru ---------- */
  var NAMA_KAJIAN = { tausiyah: "Tausiyah malam Jumat", kajian: "Kajian Ahad pagi" };
  var BATAS_CUPLIKAN = 160;

  function kajianTerbaru(jenis) {
    var hasil = null;
    keadaan.data.kajian.forEach(function (k) {
      if (k.jenis !== jenis) return;
      if (!hasil || k.tanggal > hasil.tanggal) hasil = k;
    });
    return hasil;
  }

  function potongCuplikan(teks) {
    if (teks.length <= BATAS_CUPLIKAN) return { cuplikan: teks, panjang: false };
    var potong = teks.slice(0, BATAS_CUPLIKAN);
    var spasi = potong.lastIndexOf(" ");
    if (spasi > BATAS_CUPLIKAN * 0.6) potong = potong.slice(0, spasi);
    return { cuplikan: potong.replace(/[\s,.;:]+$/, "") + "...", panjang: true };
  }

  function kartuKajian(jenis) {
    var k = kajianTerbaru(jenis);
    if (!k) return null;
    var tgl = bacaTanggal(k.tanggal);
    var terbuka = keadaan.kajianTerbuka[jenis] === true;
    var p = potongCuplikan(k.ringkasan);
    var idIsi = "kajian-isi-" + jenis;
    var ket = [];
    if (k.penceramah) ket.push(k.penceramah);
    if (tgl) ket.push(fmtTanggalPendek.format(tgl));

    return h(
      "li",
      { class: "kajian" },
      h("p", { class: "kajian-label", teks: NAMA_KAJIAN[jenis] }),
      k.judul ? h("h3", { class: "kajian-judul", teks: k.judul }) : null,
      ket.length ? h("p", { class: "kajian-ket", teks: ket.join(", ") }) : null,
      k.ringkasan ? h("p", { class: "kajian-isi", id: idIsi, teks: terbuka ? k.ringkasan : p.cuplikan }) : null,
      p.panjang
        ? h(
            "button",
            {
              type: "button",
              class: "tautan-tombol",
              "aria-expanded": terbuka ? "true" : "false",
              "aria-controls": idIsi,
              "data-kajian": jenis,
              on: {
                click: function () {
                  keadaan.kajianTerbuka[jenis] = !terbuka;
                  tampil(false);
                  var lagi = document.querySelector('[data-kajian="' + jenis + '"]');
                  if (lagi) lagi.focus();
                },
              },
            },
            terbuka ? "Tutup" : "Baca selengkapnya"
          )
        : null
    );
  }

  function bagianKajian() {
    var butir = [kartuKajian("tausiyah"), kartuKajian("kajian")].filter(Boolean);
    if (!butir.length) return null;
    return h(
      "section",
      { class: "bagian", "aria-labelledby": "judul-kajian" },
      h("h2", { class: "bagian-judul", id: "judul-kajian", teks: "Kajian terbaru" }),
      h("ul", { class: "daftar daftar-kajian" }, butir)
    );
  }

  /* Pintasan ke fitur tambahan. Tautan donasi disembunyikan bila belum ada saluran aktif. */
  function tautanCepat() {
    var IKON = {
      donasi: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
      tahlil: '<path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13C17 4 14 4.5 12 6z"/><path d="M12 6v13"/>',
      yasin: '<path d="M6 3.5h9.5a2 2 0 0 1 2 2v15H8a2 2 0 0 1-2-2z"/><path d="M6 18.5a2 2 0 0 1 2-2h9.5"/><path d="M10 8h4.5"/>',
      kiblat: '<circle cx="12" cy="12" r="8.5"/><path d="m14.8 9.2-1.6 4-4 1.6 1.6-4z"/>',
    };
    var daftar = [
      { id: "donasi", teks: "Infaq", alamat: "#kas/donasi" },
      { id: "tahlil", teks: "Zikir Tahlil", alamat: "#ibadah/tahlil" },
      { id: "yasin", teks: "Surah Yasin", alamat: "#ibadah/yasin" },
      { id: "kiblat", teks: "Arah kiblat", alamat: "#info/kiblat" },
    ].filter(function (t) {
      return !(t.id === "donasi" && keadaan.muat === "siap" && !donasiAktif().length);
    });
    return h(
      "section",
      { class: "bagian", "aria-labelledby": "judul-pintasan" },
      h("h2", { class: "bagian-judul", id: "judul-pintasan", teks: "Pintasan" }),
      h(
        "ul",
        { class: "pintasan" },
        daftar.map(function (t) {
          var svg = h("span", { class: "pintasan-ikon", "aria-hidden": "true" });
          svg.innerHTML = '<svg viewBox="0 0 24 24">' + IKON[t.id] + "</svg>"; // ikon tetap milik aplikasi, bukan data luar
          return h("li", null, h("a", { class: "pintasan-item", href: t.alamat, "data-pintasan": t.id }, svg, h("span", { teks: t.teks })));
        })
      )
    );
  }

  function viewBeranda() {
    var akar = h("div", null, h("h1", { class: "sr-only", teks: "Beranda" }), salam(), keadaan.muat === "siap" ? bannerInfo() : null, kartuNarik(), panelSalat(), tautanCepat());

    if (keadaan.muat === "siap") {
      if (keadaan.dariCadangan) {
        var waktu = keadaan.waktuCadangan ? new Date(keadaan.waktuCadangan) : null;
        akar.append(
          h("p", {
            class: "catatan",
            style: "margin-top:.75rem",
            teks:
              "Tidak ada sambungan internet. Menampilkan data tersimpan" +
              (waktu && !isNaN(waktu) ? " per " + fmtTanggalPendek.format(waktu) : "") +
              ".",
          })
        );
      }
      akar.append(
        h(
          "section",
          { class: "bagian", "aria-labelledby": "judul-kegiatan" },
          h("h2", { class: "bagian-judul", id: "judul-kegiatan", teks: "Kegiatan berikutnya" }),
          daftarKegiatan()
        ),
        bagianKajian(),
        h(
          "section",
          { class: "bagian", "aria-labelledby": "judul-kabar" },
          h("h2", { class: "bagian-judul", id: "judul-kabar", teks: "Pengumuman" }),
          daftarPengumuman()
        )
      );
    }

    akar.append(
      h("div", { class: "pasang", id: "pasang", hidden: true })
    );
    return akar;
  }

  /* ---------- Layar: Arisan ---------- */
  function panelBuku() {
    var panel = h(
      "div",
      { class: "panel" },
      h("h2", { class: "panel-judul", teks: "Lembar omzet saya" }),
      h("p", {
        class: "panel-ket",
        teks: "Foto ini hanya disimpan di HP Anda. Tidak dikirim ke mana pun dan tidak terlihat oleh anggota lain.",
      })
    );

    if (!keadaan.bukuTersedia) {
      panel.append(
        h("p", {
          class: "catatan",
          style: "margin-top:.85rem",
          teks: "HP ini tidak mengizinkan penyimpanan foto. Buka aplikasi di jendela biasa, bukan mode pribadi, lalu coba lagi.",
        })
      );
      return panel;
    }

    if (!keadaan.buku) {
      panel.append(
        h(
          "ul",
          { class: "saran" },
          h("li", { teks: "Foto satu halaman penuh, dari atas, dengan kertas rata." }),
          h("li", { teks: "Pakai cahaya terang dan hindari bayangan." }),
          h("li", { teks: "Pastikan nomor dan tulisan di tiap baris terbaca." }),
          h("li", { teks: "Simpan satu kali. Foto dipakai sampai giliran Anda berikutnya." })
        ),
        h(
          "div",
          { class: "aksi" },
          h(
            "button",
            { type: "button", id: "btn-pilih", class: "tombol tombol-penuh", on: { click: pilihFoto } },
            "Pilih atau ambil foto"
          )
        )
      );
      return panel;
    }

    var disimpan = keadaan.buku.disimpan ? new Date(keadaan.buku.disimpan) : null;
    panel.append(
      h(
        "button",
        {
          type: "button",
          class: "pratinjau",
          "aria-label": "Buka lembar omzet saya",
          on: {
            click: function (e) {
              bukaPenampil(e.currentTarget);
            },
          },
        },
        h("img", { src: keadaan.bukuUrl, alt: "Pratinjau foto lembar omzet Anda" })
      ),
      disimpan && !isNaN(disimpan)
        ? h("p", {
            class: "catatan",
            style: "margin-top:.6rem",
            teks: "Disimpan " + fmtTanggalPendek.format(disimpan) + ".",
          })
        : null
    );

    if (keadaan.konfirmasiHapus) {
      panel.append(
        h(
          "div",
          { class: "konfirmasi", role: "alertdialog", "aria-labelledby": "judul-hapus" },
          h("p", { id: "judul-hapus", teks: "Hapus foto dari HP ini?" }),
          h("p", {
            class: "catatan",
            style: "margin-top:.2rem",
            teks: "Lembar omzet kertas Anda tidak terpengaruh. Anda bisa memotretnya lagi kapan saja.",
          }),
          h(
            "div",
            { class: "aksi aksi-dua" },
            h(
              "button",
              {
                type: "button",
                id: "btn-batal",
                class: "tombol tombol-garis",
                on: {
                  click: function () {
                    keadaan.konfirmasiHapus = false;
                    tampil(false);
                  },
                },
              },
              "Batal"
            ),
            h(
              "button",
              { type: "button", class: "tombol tombol-bahaya", on: { click: hapusFoto } },
              "Hapus foto"
            )
          )
        )
      );
    } else {
      panel.append(
        h(
          "div",
          { class: "aksi" },
          h(
            "button",
            {
              type: "button",
              id: "btn-buka",
              class: "tombol tombol-penuh",
              on: {
                click: function (e) {
                  bukaPenampil(e.currentTarget);
                },
              },
            },
            "Buka lembar omzet"
          ),
          h(
            "div",
            { class: "aksi aksi-dua" },
            h("button", { type: "button", class: "tombol tombol-garis", on: { click: pilihFoto } }, "Ganti foto"),
            h(
              "button",
              {
                type: "button",
                class: "tombol tombol-bahaya",
                on: {
                  click: function () {
                    keadaan.konfirmasiHapus = true;
                    tampil(false);
                    var batal = $("#btn-batal");
                    if (batal) batal.focus();
                  },
                },
              },
              "Hapus"
            )
          )
        )
      );
    }
    return panel;
  }

  function viewArisan() {
    var akar = h("div", null, h("h1", { class: "bagian-judul", teks: "Arisan" }), panelBuku());
    var n = keadaan.muat === "siap" ? narikBerlaku() : null;
    if (n) {
      akar.append(
        h(
          "div",
          { class: "panel" },
          h("h2", { class: "panel-judul", teks: "Narik malam Jumat berikutnya" }),
          h("p", {
            class: "panel-ket",
            teks:
              n.nama +
              (n.noAnggota !== null ? ", no. anggota " + n.noAnggota : "") +
              ". " +
              fmtLengkap.format(n.tanggal) +
              (n.waktu ? ", " + n.waktu : "") +
              ".",
          })
        )
      );
    }
    return akar;
  }

  /* ---------- Ibadah: buku zikir ---------- */
  var KUNCI_BACA = "al-istiqomah:baca";
  var UKURAN_ARAB = ["Kecil", "Sedang", "Besar", "Sangat besar"];

  function bacaPilihanBaca() {
    try {
      var o = JSON.parse(localStorage.getItem(KUNCI_BACA) || "{}");
      if (o && typeof o === "object") {
        if (o.ukuran >= 1 && o.ukuran <= 4 && Math.floor(o.ukuran) === o.ukuran) keadaan.baca.ukuran = o.ukuran;
        if (typeof o.latin === "boolean") keadaan.baca.latin = o.latin;
        if (typeof o.arti === "boolean") keadaan.baca.arti = o.arti;
      }
    } catch (e) {
      /* tanpa penyimpanan: pakai pilihan bawaan */
    }
  }

  function simpanPilihanBaca() {
    try {
      localStorage.setItem(KUNCI_BACA, JSON.stringify(keadaan.baca));
    } catch (e) {
      /* abaikan */
    }
  }

  function ambilJson(alamat) {
    var kendali = new AbortController();
    var penunda = setTimeout(function () {
      kendali.abort();
    }, window.KONFIG.BATAS_WAKTU_DATA);
    return fetch(alamat, { signal: kendali.signal })
      .then(function (res) {
        clearTimeout(penunda);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .catch(function (g) {
        clearTimeout(penunda);
        throw g;
      });
  }

  /* Alamat berkas zikir hanya boleh berupa berkas data milik aplikasi. */
  function berkasZikirSah(a) {
    return typeof a === "string" && /^data\/zikir\/[a-z0-9-]+\.json$/.test(a);
  }

  function muatDaftarZikir() {
    if (keadaan.zikir.status === "memuat" || keadaan.zikir.status === "siap") return;
    keadaan.zikir.status = "memuat";
    ambilJson(window.KONFIG.BERKAS_ZIKIR).then(
      function (j) {
        var daftar = Array.isArray(j && j.buku) ? j.buku : [];
        keadaan.zikir.daftar = daftar
          .map(function (b) {
            b = b && typeof b === "object" ? b : {};
            return {
              id: typeof b.id === "string" ? b.id : "",
              judul: typeof b.judul === "string" ? b.judul : "",
              keterangan: typeof b.keterangan === "string" ? b.keterangan : "",
              berkas: b.berkas,
            };
          })
          .filter(function (b) {
            return /^[a-z0-9-]{1,30}$/.test(b.id) && b.judul && berkasZikirSah(b.berkas);
          });
        keadaan.zikir.status = "siap";
        if (ruteSekarang === "ibadah") {
          tampil(false);
          // Simpan buku untuk dibaca tanpa sinyal: permintaan ini ikut disimpan service worker.
          keadaan.zikir.daftar.forEach(function (b) {
            fetch(b.berkas).catch(function () {});
          });
        }
      },
      function () {
        keadaan.zikir.status = "gagal";
        if (ruteSekarang === "ibadah") tampil(false);
      }
    );
  }

  function muatBukuZikir(id) {
    var buku = keadaan.zikir.daftar.filter(function (b) {
      return b.id === id;
    })[0];
    if (!buku) return;
    keadaan.zikirBuku = { id: id, status: "memuat", isi: null };
    ambilJson(buku.berkas).then(
      function (j) {
        if (keadaan.zikirBuku.id !== id) return;
        keadaan.zikirBuku = { id: id, status: "siap", isi: bersihkanBuku(j, buku.judul) };
        if (ruteSekarang === "ibadah" && keadaan.sub === id) tampil(false);
      },
      function () {
        if (keadaan.zikirBuku.id !== id) return;
        keadaan.zikirBuku = { id: id, status: "gagal", isi: null };
        if (ruteSekarang === "ibadah" && keadaan.sub === id) tampil(false);
      }
    );
  }

  function teksAman(v) {
    return typeof v === "string" ? v.trim() : "";
  }

  function bersihkanBuku(j, judulCadangan) {
    j = j && typeof j === "object" ? j : {};
    var bagian = (Array.isArray(j.bagian) ? j.bagian : []).map(function (b) {
      b = b && typeof b === "object" ? b : {};
      var ulang = Number(b.ulang);
      return {
        judul: teksAman(b.judul),
        arab: teksAman(b.arab),
        latin: teksAman(b.latin),
        arti: teksAman(b.arti),
        catatan: teksAman(b.catatan),
        ulang: isFinite(ulang) && ulang > 1 && ulang <= 1000 ? Math.floor(ulang) : 0,
        ayat: (Array.isArray(b.ayat) ? b.ayat : []).map(function (a) {
          a = a && typeof a === "object" ? a : {};
          return { no: Number(a.no) || 0, arab: teksAman(a.arab), latin: teksAman(a.latin), arti: teksAman(a.arti) };
        }),
      };
    });
    return {
      judul: teksAman(j.judul) || judulCadangan,
      pembuka: teksAman(j.pembuka),
      sumber: teksAman(j.sumber),
      bagian: bagian,
    };
  }

  function terapkanBaca(wadah) {
    wadah.setAttribute("data-ukuran", String(keadaan.baca.ukuran));
    wadah.setAttribute("data-latin", keadaan.baca.latin ? "1" : "0");
    wadah.setAttribute("data-arti", keadaan.baca.arti ? "1" : "0");
  }

  function kontrolBaca(wadah) {
    var info = h("span", { class: "baca-ukuran-info", "aria-live": "polite" });
    var kecil = h("button", { type: "button", class: "tombol tombol-kecil tombol-garis", "aria-label": "Perkecil huruf Arab" }, "A-");
    var besar = h("button", { type: "button", class: "tombol tombol-kecil tombol-garis", "aria-label": "Perbesar huruf Arab" }, "A+");
    var tArti = h("button", { type: "button", class: "tombol tombol-kecil tombol-garis", id: "baca-arti" }, "Terjemah");
    var tLatin = h("button", { type: "button", class: "tombol tombol-kecil tombol-garis", id: "baca-latin" }, "Latin");

    function segarkan() {
      info.textContent = "Huruf Arab: " + UKURAN_ARAB[keadaan.baca.ukuran - 1];
      kecil.disabled = keadaan.baca.ukuran <= 1;
      besar.disabled = keadaan.baca.ukuran >= 4;
      tArti.setAttribute("aria-pressed", keadaan.baca.arti ? "true" : "false");
      tLatin.setAttribute("aria-pressed", keadaan.baca.latin ? "true" : "false");
      terapkanBaca(wadah);
      simpanPilihanBaca();
    }
    kecil.addEventListener("click", function () {
      keadaan.baca.ukuran = Math.max(1, keadaan.baca.ukuran - 1);
      segarkan();
    });
    besar.addEventListener("click", function () {
      keadaan.baca.ukuran = Math.min(4, keadaan.baca.ukuran + 1);
      segarkan();
    });
    tArti.addEventListener("click", function () {
      keadaan.baca.arti = !keadaan.baca.arti;
      segarkan();
    });
    tLatin.addEventListener("click", function () {
      keadaan.baca.latin = !keadaan.baca.latin;
      segarkan();
    });
    segarkan();
    return h("div", { class: "baca-kontrol", role: "group", "aria-label": "Pengaturan tampilan baca" }, h("div", { class: "baca-tombol" }, kecil, besar, tArti, tLatin), info);
  }

  function bagianBaca(b) {
    var kepala = [];
    if (b.judul) kepala.push(h("h2", { class: "zikir-judul-bagian", teks: b.judul }));
    if (b.ulang) kepala.push(h("span", { class: "zikir-ulang", teks: "Dibaca " + b.ulang + " kali" }));
    var isi = [];
    if (b.catatan) isi.push(h("p", { class: "zikir-catatan", teks: b.catatan }));
    if (b.ayat.length) {
      isi.push(
        h(
          "ol",
          { class: "zikir-ayat" },
          b.ayat.map(function (a) {
            return h(
              "li",
              null,
              h("span", { class: "zikir-no", "aria-label": "Ayat " + a.no, teks: String(a.no) }),
              h(
                "div",
                { class: "zikir-teks" },
                a.arab ? h("p", { class: "zikir-arab", lang: "ar", dir: "rtl", teks: a.arab }) : null,
                a.latin ? h("p", { class: "zikir-latin", teks: a.latin }) : null,
                a.arti ? h("p", { class: "zikir-arti", teks: a.arti }) : null
              )
            );
          })
        )
      );
    } else {
      isi.push(
        h(
          "div",
          { class: "zikir-teks" },
          b.arab ? h("p", { class: "zikir-arab", lang: "ar", dir: "rtl", teks: b.arab }) : null,
          b.latin ? h("p", { class: "zikir-latin", teks: b.latin }) : null,
          b.arti ? h("p", { class: "zikir-arti", teks: b.arti }) : null
        )
      );
    }
    return h("section", { class: "zikir-bagian" }, h("div", { class: "zikir-kepala" }, kepala), isi);
  }

  function viewPembaca() {
    var id = keadaan.sub;
    var kembali = h("a", { href: "#ibadah", class: "tautan-kembali" }, "← Semua zikir");
    var akar = h("div", null, kembali);

    if (keadaan.zikir.status === "idle") muatDaftarZikir();
    if (keadaan.zikir.status === "idle" || keadaan.zikir.status === "memuat") {
      akar.append(h("p", { class: "catatan", style: "margin-top:1rem", teks: "Memuat..." }));
      return akar;
    }
    var ada = keadaan.zikir.daftar.some(function (b) {
      return b.id === id;
    });
    if (keadaan.zikir.status === "gagal" || !ada) {
      akar.append(
        h("h1", { class: "bagian-judul", style: "margin-top:1rem", teks: "Buku tidak ditemukan" }),
        h("p", { class: "catatan", teks: ada ? "" : "Buku zikir ini tidak ada. Kembali ke daftar lalu pilih lagi." })
      );
      return akar;
    }
    if (keadaan.zikirBuku.id !== id || keadaan.zikirBuku.status === "idle") muatBukuZikir(id);
    var bk = keadaan.zikirBuku;
    if (bk.status === "gagal") {
      akar.append(
        h("h1", { class: "bagian-judul", style: "margin-top:1rem", teks: "Buku belum bisa dimuat" }),
        h("p", { class: "catatan", teks: "Cek sambungan internet lalu coba lagi. Setelah pernah dibuka sekali, buku ini bisa dibaca tanpa sinyal." }),
        h("button", { type: "button", class: "tombol tombol-garis", style: "margin-top:1rem", on: { click: function () { keadaan.zikirBuku = { id: "", status: "idle", isi: null }; tampil(false); } } }, "Coba lagi")
      );
      return akar;
    }
    if (bk.status !== "siap" || !bk.isi) {
      akar.append(h("p", { class: "catatan", style: "margin-top:1rem", teks: "Memuat buku..." }));
      return akar;
    }

    var buku = bk.isi;
    var wadah = h("div", { class: "baca" });
    terapkanBaca(wadah);
    tambah(wadah, [
      h("h1", { class: "bagian-judul", teks: buku.judul }),
      buku.pembuka ? h("p", { class: "zikir-pembuka", teks: buku.pembuka }) : null,
      kontrolBaca(wadah),
      buku.bagian.map(bagianBaca),
      buku.sumber ? h("p", { class: "zikir-sumber", teks: buku.sumber }) : null,
    ]);
    akar.append(wadah);
    return akar;
  }

  function viewIbadah() {
    if (keadaan.sub) return viewPembaca();
    muatDaftarZikir();
    var panel = h(
      "div",
      { class: "panel" },
      h("h2", { class: "panel-judul", teks: "Buku zikir" }),
      h("p", { class: "panel-ket", teks: "Untuk dibaca bersama atau sendiri. Setelah dibuka sekali, bisa dibaca tanpa sinyal." })
    );
    if (keadaan.zikir.status === "memuat" || keadaan.zikir.status === "idle") {
      panel.append(h("p", { class: "catatan", style: "margin-top:.85rem", teks: "Memuat daftar..." }));
    } else if (keadaan.zikir.status === "gagal" || !keadaan.zikir.daftar.length) {
      panel.append(
        h("p", { class: "catatan", style: "margin-top:.85rem", teks: "Daftar zikir belum bisa dimuat. Cek sambungan internet lalu coba lagi." }),
        h("button", { type: "button", class: "tombol tombol-garis", style: "margin-top:.85rem", on: { click: function () { keadaan.zikir.status = "idle"; tampil(false); } } }, "Coba lagi")
      );
    } else {
      panel.append(
        h(
          "ul",
          { class: "zikir-daftar daftar" },
          keadaan.zikir.daftar.map(function (b) {
            return h(
              "li",
              null,
              h(
                "a",
                { href: "#ibadah/" + b.id, class: "zikir-butir" },
                h("span", { class: "zikir-butir-judul", teks: b.judul }),
                b.keterangan ? h("span", { class: "zikir-butir-ket", teks: b.keterangan }) : null
              )
            );
          })
        )
      );
    }
    return h(
      "div",
      null,
      h("h1", { class: "bagian-judul", teks: "Zikir dan tausiyah" }),
      panel,
      h("p", { class: "catatan", style: "margin-top:1rem", teks: "Arsip tausiyah dan kajian akan menyusul di halaman ini." })
    );
  }

  /* ---------- Layar: Kas ---------- */
  var fmtAngka = new Intl.NumberFormat("id-ID");
  var fmtHariBulan = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" });

  function rupiah(n) {
    return (n < 0 ? "-Rp " : "Rp ") + fmtAngka.format(Math.abs(n));
  }

  function barisUang(b, tanda) {
    var tgl = bacaTanggal(b.tanggal);
    return h(
      "li",
      { class: "uang" },
      h(
        "div",
        { class: "uang-teks" },
        h("p", { class: "uang-ket", teks: b.keterangan }),
        tgl ? h("p", { class: "kegiatan-ket", teks: fmtTanggalPendek.format(tgl) }) : null
      ),
      h("p", { class: "uang-jumlah", teks: tanda + rupiah(b.jumlah) })
    );
  }

  function salinNomor(nomor) {
    var bersih = String(nomor).replace(/[^0-9]/g, "");
    var selesai = function () {
      toast("Nomor rekening disalin.");
    };
    var cadangan = function () {
      toast("Salin manual: " + nomor);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(bersih).then(selesai, cadangan);
    } else cadangan();
  }

  /* Menyimpan gambar QRIS ke HP. Urutan: (1) lembar bagikan bawaan HP bila bisa
   * menerima berkas, supaya pengguna memilih "Simpan ke Foto/Galeri"; (2) unduh
   * biasa; (3) bila gambar tidak bisa diambil (alamat lain tanpa izin CORS),
   * buka gambar di tab baru dan minta pengguna menekan lama. */
  function namaBerkasQris(judul, jenis) {
    var dasar = String(judul || "qris").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "qris";
    var ekst = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }[jenis] || "png";
    return "qris-" + dasar + "." + ekst;
  }

  function simpanGambarQris(url, judul) {
    var cadangan = function () {
      window.open(url, "_blank", "noopener");
      toast("Tekan lama pada gambar, lalu pilih Simpan.");
    };
    fetch(url, { referrerPolicy: "no-referrer" })
      .then(function (r) {
        if (!r.ok) throw new Error("gagal");
        return r.blob();
      })
      .then(function (blob) {
        if (!/^image\//.test(blob.type)) throw new Error("bukan-gambar");
        var nama = namaBerkasQris(judul, blob.type);
        var berkas = new File([blob], nama, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [berkas] })) {
          return navigator.share({ files: [berkas], title: "QRIS " + judul }).catch(function (e) {
            if (e && e.name === "AbortError") return; // pengguna menutup lembar bagikan
            throw e;
          });
        }
        var alamat = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = alamat;
        a.download = nama;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(alamat);
        }, 4000);
        toast("Gambar QRIS diunduh. Pilih dari galeri di aplikasi bank.");
      })
      .catch(cadangan);
  }

  function donasiAktif() {
    if (!keadaan.data) return [];
    var hariIni = awalHari(new Date());
    return keadaan.data.donasi.filter(function (d) {
      if (!d.sampai) return true;
      var tgl = bacaTanggal(d.sampai);
      return !tgl || selisihHari(tgl, hariIni) >= 0;
    });
  }

  function bagianDonasi() {
    var daftar = donasiAktif();
    if (!daftar.length) return null;
    return h(
      "section",
      { class: "bagian", "aria-labelledby": "judul-donasi" },
      h("h2", { class: "bagian-judul", id: "judul-donasi", teks: "Infaq" }),
      h(
        "p",
        { class: "catatan", teks: "Pastikan nama bank dan atas nama sesuai sebelum mengirim. Bila ragu, tanyakan ke pengurus." }
      ),
      h(
        "ul",
        { class: "daftar daftar-donasi" },
        daftar.map(function (d, i) {
          return h(
            "li",
            { class: "donasi" },
            h("h3", { class: "donasi-judul", teks: d.judul }),
            d.keterangan ? h("p", { class: "donasi-ket", teks: d.keterangan }) : null,
            d.nomor
              ? h(
                  "div",
                  { class: "donasi-rek" },
                  h("p", { class: "donasi-bank", teks: d.bank }),
                  h("p", { class: "donasi-nomor", teks: d.nomor }),
                  h("p", { class: "donasi-nama", teks: "a.n. " + d.atasNama }),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "tombol tombol-kecil tombol-garis",
                      "aria-label": "Salin nomor rekening " + d.judul,
                      on: {
                        click: function () {
                          salinNomor(d.nomor);
                        },
                      },
                    },
                    "Salin nomor"
                  )
                )
              : null,
            d.qrisUrl
              ? h(
                  "figure",
                  { class: "donasi-qris" },
                  h("img", {
                    src: d.qrisUrl,
                    alt: "Kode QRIS untuk " + d.judul,
                    loading: "lazy",
                    referrerpolicy: "no-referrer",
                    on: {
                      error: function (e) {
                        var f = e.target.closest("figure");
                        if (f) f.replaceChildren(h("p", { class: "catatan", teks: "Gambar QRIS belum bisa dimuat." }));
                      },
                    },
                  }),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "tombol tombol-kecil tombol-garis",
                      "aria-label": "Simpan gambar QRIS " + d.judul,
                      on: {
                        click: function () {
                          simpanGambarQris(d.qrisUrl, d.judul);
                        },
                      },
                    },
                    "Simpan gambar QRIS"
                  ),
                  h("figcaption", {
                    class: "catatan",
                    teks: "Pindai dengan aplikasi bank atau dompet digital. Di HP ini, simpan gambarnya lalu pilih dari galeri di aplikasi bank.",
                  })
                )
              : null
          );
        })
      )
    );
  }

  function viewKas() {
    var akar = h("div", null, h("h1", { class: "bagian-judul", teks: "Kas anggota" }));
    if (keadaan.muat === "memuat") {
      akar.append(h("p", { class: "catatan", teks: "Memuat data kas..." }));
      return akar;
    }
    if (keadaan.muat === "gagal") {
      akar.append(
        h("p", { class: "catatan", teks: "Data kas belum bisa dimuat. Cek sambungan internet, lalu coba lagi." }),
        h("button", { type: "button", class: "tombol tombol-garis", style: "margin-top:1rem", on: { click: muatData } }, "Coba lagi")
      );
      return akar;
    }
    var kas = keadaan.data.kas;
    if (!kas) {
      akar.append(h("p", { class: "catatan", teks: "Belum ada data kas. Bendahara akan mengisinya." }), bagianDonasi());
      return akar;
    }

    if (keadaan.dariCadangan) {
      akar.append(h("p", { class: "catatan", teks: "Tidak ada sambungan internet. Menampilkan data tersimpan." }));
    }

    var dari = bacaTanggal(kas.pekan.dari);
    var sampai = bacaTanggal(kas.pekan.sampai);
    var periode = dari && sampai ? fmtHariBulan.format(dari) + " sampai " + fmtHariBulan.format(sampai) : "";
    var perbarui = bacaTanggal(kas.diperbarui);

    akar.append(
      h(
        "article",
        { class: "saldo", "aria-labelledby": "saldo-judul" },
        h("h2", { class: "saldo-judul", id: "saldo-judul", teks: "Saldo kas" }),
        h("p", { class: "saldo-angka", teks: rupiah(kas.saldo) }),
        perbarui ? h("p", { class: "saldo-ket", teks: "Diperbarui " + fmtTanggalPendek.format(perbarui) }) : null
      ),
      h(
        "section",
        { class: "bagian", "aria-labelledby": "kas-masuk" },
        h("h2", { class: "bagian-judul", id: "kas-masuk", teks: "Pemasukan minggu ini" }),
        periode ? h("p", { class: "catatan", teks: periode }) : null,
        h("p", { class: "uang-total", teks: rupiah(kas.pekan.total) }),
        kas.pekan.rincian.length
          ? h("ul", { class: "daftar" }, kas.pekan.rincian.map(function (b) { return barisUang(b, "+ "); }))
          : h("p", { class: "catatan", teks: "Belum ada pemasukan minggu ini." })
      ),
      h(
        "section",
        { class: "bagian", "aria-labelledby": "kas-keluar" },
        h("h2", { class: "bagian-judul", id: "kas-keluar", teks: "Pengeluaran" }),
        kas.pengeluaran.length
          ? h("ul", { class: "daftar" }, kas.pengeluaran.map(function (b) { return barisUang(b, "- "); }))
          : h("p", { class: "catatan", teks: "Belum ada pengeluaran tercatat." })
      ),
      bagianDonasi()
    );
    return akar;
  }

  /* ---------- Waktu salat dan kiblat ---------- */
  var penundaSalat = null;

  function koordinat() {
    // bawaan: sekitar Masjid Al-Ikhlas Serua, supaya config.js lama tetap bekerja
    var k = window.KONFIG.KOORDINAT || { lintang: -6.397, bujur: 106.739 };
    return { lintang: Number(k.lintang), bujur: Number(k.bujur) };
  }

  function opsiSalat() {
    return { ihtiyat: Number(window.KONFIG.IHTIYAT_MENIT) >= 0 ? Number(window.KONFIG.IHTIYAT_MENIT) : 2 };
  }

  /* Tanggal dan menit sekarang menurut zona masjid (bukan zona HP). */
  function sekarangSetempat() {
    var f = new Intl.DateTimeFormat("en-CA", {
      timeZone: window.KONFIG.ZONA_NAMA || "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    var p = {};
    f.formatToParts(new Date()).forEach(function (x) {
      p[x.type] = x.value;
    });
    return { iso: p.year + "-" + p.month + "-" + p.day, menit: Number(p.hour) * 60 + Number(p.minute) };
  }

  function teksSisa(menit) {
    if (menit < 1) return "kurang dari semenit lagi";
    if (menit < 60) return menit + " menit lagi";
    var j = Math.floor(menit / 60);
    var m = menit % 60;
    return j + " jam" + (m ? " " + m + " menit" : "") + " lagi";
  }

  function hitungSalat() {
    var k = koordinat();
    var z = window.KONFIG.ZONA_JAM === undefined ? 7 : Number(window.KONFIG.ZONA_JAM);
    if (!isFinite(k.lintang) || !isFinite(k.bujur) || !isFinite(z)) return null;
    var sk = sekarangSetempat();
    var jadwal = window.Salat.jadwal(sk.iso, k.lintang, k.bujur, z, opsiSalat());
    if (!jadwal) return null;
    var berikut = window.Salat.berikutnya(sk.iso, sk.menit, k.lintang, k.bujur, z, opsiSalat());
    return { iso: sk.iso, jadwal: jadwal, berikut: berikut };
  }

  function teksBerikutnya(hs) {
    var b = hs && hs.berikut;
    if (!b) return "";
    return (
      "Salat berikutnya: " +
      window.Salat.NAMA[b.kunci] +
      (b.besok ? " (besok) " : " ") +
      window.Salat.format(b.menit) +
      ", " +
      teksSisa(b.sisa)
    );
  }

  function isiDaftarSalat(hs) {
    if (!hs) return [h("p", { class: "catatan", teks: "Waktu salat belum bisa dihitung. Periksa koordinat di pengaturan aplikasi." })];
    return [
      h(
        "ul",
        { class: "salat-daftar" },
        window.Salat.URUTAN.map(function (kunci) {
          var berikut = hs.berikut && !hs.berikut.besok && hs.berikut.kunci === kunci;
          return h(
            "li",
            { class: "salat-baris" + (berikut ? " salat-berikut" : ""), "aria-current": berikut ? "true" : null },
            h("span", { class: "salat-nama", teks: window.Salat.NAMA[kunci] + (kunci === "terbit" ? " (bukan waktu salat)" : "") }),
            h("span", { class: "salat-jam", teks: window.Salat.format(hs.jadwal[kunci]) })
          );
        })
      ),
    ];
  }

  /* Memperbarui "salat berikutnya" tanpa menggambar ulang halaman. */
  function segarkanSalat() {
    var hs = hitungSalat();
    var baris = document.querySelector("#salat-berikut");
    if (baris) baris.textContent = teksBerikutnya(hs);
    var daftar = document.querySelector("#salat-isi");
    if (daftar) daftar.replaceChildren.apply(daftar, isiDaftarSalat(hs));
    var judul = document.querySelector("#salat-tanggal");
    if (judul && hs) judul.textContent = fmtLengkap.format(bacaTanggal(hs.iso));
  }

  function aturPenundaSalat() {
    clearInterval(penundaSalat);
    penundaSalat = null;
    if (ruteSekarang === "beranda") {
      penundaSalat = setInterval(segarkanSalat, 30000);
    }
  }

  function panelSalat() {
    var hs = hitungSalat();
    return h(
      "section",
      { class: "panel", "aria-labelledby": "salat-judul" },
      h("h2", { class: "panel-judul", id: "salat-judul", teks: "Waktu salat" }),
      h("p", { class: "panel-ket", id: "salat-tanggal", teks: hs ? fmtLengkap.format(bacaTanggal(hs.iso)) : "" }),
      h("p", { class: "salat-berikut-teks", id: "salat-berikut", role: "status", teks: teksBerikutnya(hs) }),
      h("div", { id: "salat-isi" }, isiDaftarSalat(hs)),
      h("p", {
        class: "bantu",
        style: "margin-top:.75rem",
        teks: "Perkiraan hitungan untuk lokasi masjid, mengikuti sudut Kemenag RI (Subuh 20, Isya 18) dan pengaman " + opsiSalat().ihtiyat + " menit. Bisa berbeda satu atau dua menit dengan jadwal resmi; patokan tetap jadwal masjid.",
      })
    );
  }

  /* ----- Arah kiblat ----- */
  var NS = "http://www.w3.org/2000/svg";

  function svgEl(nama, atribut, anak) {
    var el = document.createElementNS(NS, nama);
    Object.keys(atribut || {}).forEach(function (k) {
      el.setAttribute(k, String(atribut[k]));
    });
    (anak || []).forEach(function (a) {
      el.append(a);
    });
    return el;
  }

  function kiblatDerajat() {
    var k = koordinat();
    if (!isFinite(k.lintang) || !isFinite(k.bujur)) return null;
    return window.Salat.kiblat(k.lintang, k.bujur);
  }

  function gambarKompas(kib) {
    var teksArah = function (t, x, y) {
      return svgEl("text", { x: x, y: y, "text-anchor": "middle", "dominant-baseline": "middle", class: "kompas-arah" }, [document.createTextNode(t)]);
    };
    var dial = svgEl("g", { id: "kompas-dial" }, [
      svgEl("circle", { cx: 110, cy: 110, r: 98, class: "kompas-cincin" }),
      teksArah("U", 110, 24),
      teksArah("T", 196, 110),
      teksArah("S", 110, 196),
      teksArah("B", 24, 110),
      svgEl("g", { id: "kompas-jarum", transform: "rotate(" + kib.toFixed(2) + " 110 110)" }, [
        svgEl("line", { x1: 110, y1: 110, x2: 110, y2: 46, class: "kompas-garis" }),
        svgEl("circle", { cx: 110, cy: 40, r: 11, class: "kompas-kakbah" }),
        svgEl("rect", { x: 105, y: 35, width: 10, height: 10, rx: 1.5, class: "kompas-kakbah-isi" }),
      ]),
      svgEl("circle", { cx: 110, cy: 110, r: 5, class: "kompas-pusat" }),
    ]);
    return svgEl("svg", { viewBox: "0 0 220 220", class: "kompas", role: "img", "aria-label": "Kompas arah kiblat " + Math.round(kib) + " derajat" }, [
      dial,
      svgEl("path", { d: "M110 2 L102 16 L118 16 Z", class: "kompas-depan" }),
    ]);
  }

  /* Memutar piringan sesuai arah HP. arah null = kompas mati (utara di atas). */
  function perbaruiKompas() {
    var kib = kiblatDerajat();
    var dial = document.querySelector("#kompas-dial");
    var status = document.querySelector("#kompas-status");
    var tombol = document.querySelector("#kompas-tombol");
    var akar = document.querySelector(".kompas-bungkus");
    if (!dial || kib === null) return;
    var k = keadaan.kompas;
    var arah = k.aktif ? k.arah : null;
    dial.setAttribute("transform", arah === null ? "" : "rotate(" + (-arah).toFixed(1) + " 110 110)");
    var lurus = arah !== null && Math.abs(window.Salat.selisihArah(kib, arah)) <= 3;
    if (akar) akar.classList.toggle("kompas-lurus", lurus);
    if (status) {
      if (!k.aktif) status.textContent = k.status || "";
      else if (arah === null) status.textContent = k.status || "Menunggu data kompas...";
      else if (lurus) status.textContent = "Menghadap kiblat.";
      else status.textContent = "Arah HP " + Math.round(arah) + " derajat. Putar HP sampai tanda Ka'bah berada di bawah segitiga atas.";
    }
    if (tombol) tombol.textContent = k.aktif ? "Matikan kompas" : "Aktifkan kompas";
  }

  function arahDariPeristiwa(e) {
    if (typeof e.webkitCompassHeading === "number" && isFinite(e.webkitCompassHeading)) return e.webkitCompassHeading;
    if (e.absolute === true && typeof e.alpha === "number") return (360 - e.alpha + 360) % 360;
    return null;
  }

  var penundaKompas = null;
  function terimaArah(e) {
    var a = arahDariPeristiwa(e);
    if (a === null) return;
    clearTimeout(penundaKompas);
    keadaan.kompas.arah = a;
    keadaan.kompas.status = "";
    perbaruiKompas();
  }

  function matikanKompas() {
    window.removeEventListener("deviceorientationabsolute", terimaArah, true);
    window.removeEventListener("deviceorientation", terimaArah, true);
    clearTimeout(penundaKompas);
    keadaan.kompas = { aktif: false, arah: null, status: "" };
  }

  function nyalakanKompas() {
    var DOE = window.DeviceOrientationEvent;
    if (!DOE) {
      keadaan.kompas.status = "HP atau peramban ini tidak mendukung kompas. Pakai arah derajat di atas.";
      perbaruiKompas();
      return;
    }
    var minta = typeof DOE.requestPermission === "function" ? DOE.requestPermission() : Promise.resolve("granted");
    Promise.resolve(minta).then(
      function (izin) {
        if (izin !== "granted") {
          keadaan.kompas.status = "Izin kompas tidak diberikan. Pakai arah derajat di atas.";
          perbaruiKompas();
          return;
        }
        keadaan.kompas.aktif = true;
        keadaan.kompas.arah = null;
        keadaan.kompas.status = "Menunggu data kompas...";
        window.addEventListener("deviceorientationabsolute", terimaArah, true);
        window.addEventListener("deviceorientation", terimaArah, true);
        clearTimeout(penundaKompas);
        penundaKompas = setTimeout(function () {
          if (keadaan.kompas.aktif && keadaan.kompas.arah === null) {
            keadaan.kompas.status = "HP ini tidak mengirim data arah. Pakai arah derajat di atas.";
            perbaruiKompas();
          }
        }, 3000);
        perbaruiKompas();
      },
      function () {
        keadaan.kompas.status = "Izin kompas tidak diberikan. Pakai arah derajat di atas.";
        perbaruiKompas();
      }
    );
  }

  function panelKiblat() {
    var kib = kiblatDerajat();
    if (kib === null) {
      return h("section", { class: "panel" }, h("h2", { class: "panel-judul", teks: "Arah kiblat" }), h("p", { class: "catatan", teks: "Arah kiblat belum bisa dihitung. Periksa koordinat di pengaturan aplikasi." }));
    }
    return h(
      "section",
      { class: "panel", "aria-labelledby": "kiblat-judul" },
      h("h2", { class: "panel-judul", id: "kiblat-judul", teks: "Arah kiblat" }),
      h("p", { class: "kiblat-angka", teks: Math.round(kib * 10) / 10 + "°" }),
      h("p", { class: "panel-ket", teks: "Dari utara sejati ke arah " + window.Salat.mataAngin(kib) + ", searah jarum jam." }),
      h("div", { class: "kompas-bungkus" }, gambarKompas(kib)),
      h("p", { id: "kompas-status", class: "status-pesan", role: "status", "aria-live": "polite" }),
      h(
        "div",
        { class: "aksi" },
        h(
          "button",
          {
            type: "button",
            class: "tombol tombol-garis tombol-penuh",
            id: "kompas-tombol",
            on: {
              click: function () {
                if (keadaan.kompas.aktif) {
                  matikanKompas();
                  perbaruiKompas();
                } else nyalakanKompas();
              },
            },
          },
          "Aktifkan kompas"
        )
      ),
      h("p", {
        class: "bantu",
        style: "margin-top:.75rem",
        teks: "Kompas HP bisa meleset. Letakkan HP mendatar, jauhkan dari logam dan magnet, dan gerakkan membentuk angka 8 bila kurang tepat. Untuk salat, tetap utamakan arah kiblat masjid.",
      })
    );
  }

  function viewInfo() {
    var akar = h("div", null, h("h1", { class: "bagian-judul", teks: "Informasi" }), panelKiblat());
    if (keadaan.muat === "siap") {
      akar.append(
        h(
          "section",
          { class: "bagian", "aria-labelledby": "info-kegiatan" },
          h("h2", { class: "bagian-judul", id: "info-kegiatan", teks: "Kegiatan rutin" }),
          daftarKegiatan()
        ),
        h(
          "section",
          { class: "bagian", "aria-labelledby": "info-kabar" },
          h("h2", { class: "bagian-judul", id: "info-kabar", teks: "Pengumuman" }),
          daftarPengumuman()
        )
      );
    }
    return akar;
  }

  /* ---------- Layar yang masih disiapkan ---------- */
  function viewSegera(judul, ket, namaIkon) {
    return h(
      "div",
      { class: "kosong" },
      ikon(namaIkon),
      h("h1", { class: "bagian-judul", teks: judul }),
      h("p", { class: "catatan", teks: ket })
    );
  }

  /* ---------- Menu kebab, pengaturan, sejarah, tentang ---------- */
  var VERSI_APLIKASI = "v11"; // samakan dengan VERSI di sw.js

  function viewPengaturan() {
    var T = window.Tampilan;

    function kelompok(nama, legenda, bantu, urutan, daftar, nilaiSekarang, ubah) {
      var item = {};
      var baris = h("div", { class: "pilihan-baris" });
      urutan.forEach(function (k) {
        var nama1 = typeof daftar[k] === "string" ? daftar[k] : daftar[k].nama;
        var input = h("input", { type: "radio", name: nama, value: k, id: nama + "-" + k });
        input.checked = nilaiSekarang() === k;
        var label = h("label", { class: "pilihan-item" + (input.checked ? " terpilih" : ""), for: nama + "-" + k }, input, h("span", { teks: nama1 }));
        input.addEventListener("change", function () {
          ubah(k);
          Object.keys(item).forEach(function (j) {
            item[j].classList.toggle("terpilih", j === k);
          });
        });
        item[k] = label;
        baris.append(label);
      });
      return h(
        "fieldset",
        { class: "kelompok-pilihan" },
        h("legend", { class: "panel-judul", teks: legenda }),
        bantu ? h("p", { class: "panel-ket", teks: bantu }) : null,
        baris
      );
    }

    var kelompokUkuran = kelompok(
      "ukuran-huruf",
      "Ukuran huruf",
      "Berlaku untuk seluruh aplikasi di HP ini.",
      T.URUTAN_UKURAN,
      T.UKURAN,
      T.ukuran,
      T.aturUkuran
    );
    var kelompokTema = kelompok(
      "tema-warna",
      "Tampilan warna",
      "\"Ikuti HP\" mengikuti mode gelap atau terang di pengaturan HP Anda.",
      T.URUTAN_TEMA,
      T.TEMA,
      T.tema,
      T.aturTema
    );

    function segarkanAplikasi() {
      toast("Memeriksa pembaruan...");
      var selesai = function () {
        setTimeout(function () {
          location.reload();
        }, 600);
      };
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(function (r) {
          return r ? r.update() : null;
        }).then(selesai, selesai);
      } else selesai();
    }

    return h(
      "div",
      null,
      h("h1", { class: "bagian-judul", teks: "Pengaturan" }),
      h("section", { class: "panel" }, kelompokUkuran),
      h("section", { class: "panel" }, kelompokTema),
      h(
        "section",
        { class: "panel" },
        h("h2", { class: "panel-judul", teks: "Lainnya" }),
        h("p", { class: "panel-ket", teks: "Ukuran huruf di halaman bacaan Yasin dan Tahlil diatur terpisah, lewat tombol di halaman bacaan itu. Pilihan disimpan di HP ini saja." }),
        h(
          "div",
          { class: "aksi" },
          h("button", { type: "button", class: "tombol tombol-garis", id: "pengaturan-awal", on: { click: function () {
            T.kembalikan();
            tampil(false);
            toast("Pengaturan dikembalikan ke awal.");
          } } }, "Kembalikan ke awal"),
          h("button", { type: "button", class: "tombol tombol-garis", id: "pengaturan-segarkan", on: { click: segarkanAplikasi } }, "Periksa pembaruan aplikasi")
        )
      )
    );
  }

  var sejarah = { status: "kosong", isi: null };

  function muatSejarah() {
    if (sejarah.status === "memuat" || sejarah.status === "siap") return;
    sejarah.status = "memuat";
    ambilJson("data/sejarah.json").then(
      function (j) {
        j = j && typeof j === "object" ? j : {};
        var para = (Array.isArray(j.paragraf) ? j.paragraf : []).filter(function (x) {
          return typeof x === "string" && x.trim();
        });
        sejarah.isi = {
          judul: typeof j.judul === "string" && j.judul.trim() ? j.judul.trim() : "Sejarah majelis taklim",
          draf: j.draf === true,
          paragraf: para.map(function (x) {
            return x.trim();
          }),
        };
        sejarah.status = para.length ? "siap" : "gagal";
        if (ruteSekarang === "sejarah") tampil(false);
      },
      function () {
        sejarah.status = "gagal";
        if (ruteSekarang === "sejarah") tampil(false);
      }
    );
  }

  function viewSejarah() {
    muatSejarah();
    var akar = h("div", null);
    if (sejarah.status === "siap") {
      akar.append(h("h1", { class: "bagian-judul", teks: sejarah.isi.judul }));
      if (sejarah.isi.draf) {
        akar.append(h("p", { class: "catatan catatan-draf", teks: "Teks ini masih draf. Pengurus akan melengkapinya." }));
      }
      akar.append(
        h(
          "div",
          { class: "bacaan" },
          sejarah.isi.paragraf.map(function (x) {
            return h("p", { teks: x });
          })
        )
      );
    } else if (sejarah.status === "gagal") {
      akar.append(
        h("h1", { class: "bagian-judul", teks: "Sejarah majelis taklim" }),
        h("p", { class: "catatan", teks: "Sejarah belum bisa dimuat. Periksa sambungan, lalu buka lagi halaman ini." }),
        h("button", { type: "button", class: "tombol tombol-garis", on: { click: function () {
          sejarah.status = "kosong";
          tampil(false);
        } } }, "Coba lagi")
      );
    } else {
      akar.append(h("h1", { class: "bagian-judul", teks: "Sejarah majelis taklim" }), h("p", { class: "catatan", teks: "Memuat..." }));
    }
    return akar;
  }

  function viewTentang() {
    return h(
      "div",
      null,
      h("h1", { class: "bagian-judul", teks: "Tentang aplikasi" }),
      h(
        "div",
        { class: "bacaan" },
        h("p", { teks: "Majelis Taklim Al-Istiqomah, Masjid Jami' Al-Ikhlas Serua, Bojongsari, Depok. Aplikasi ini membantu jemaah mengetahui giliran narik arisan, kas, jadwal kegiatan, waktu salat, arah kiblat, serta bacaan Yasin dan Tahlil." }),
        h("p", { teks: "Foto lembar omzet arisan hanya tersimpan di HP Anda dan tidak dikirim ke mana pun. Aplikasi juga tidak membaca nominal dari foto itu." }),
        h("p", { teks: "Yasin dan Tahlil bisa dibaca tanpa sinyal setelah dibuka sekali. Waktu salat dihitung di HP, sehingga bisa berbeda satu sampai dua menit dari jadwal masjid. Untuk ibadah, ikuti jadwal dan arah kiblat masjid." }),
        h("p", { teks: "Teks Al-Qur'an pada bacaan bersumber dari paket quran-json (CC BY-SA 4.0). Bagian Tahlil selain ayat Al-Qur'an masih menunggu pemeriksaan ustaz." }),
        h("p", { class: "catatan", teks: "Versi aplikasi: " + VERSI_APLIKASI })
      )
    );
  }

  var DOMAIN_SOSMED = {
    youtube: { nama: "YouTube", domain: "(youtube\\.com|youtu\\.be)" },
    instagram: { nama: "Instagram", domain: "instagram\\.com" },
    facebook: { nama: "Facebook", domain: "(facebook\\.com|fb\\.com)" },
  };

  function alamatSosmedSah(kunci, url) {
    if (typeof url !== "string") return false;
    var re = new RegExp("^https://([a-z0-9-]+\\.)*" + DOMAIN_SOSMED[kunci].domain + "(/[^\\s\"'<>]*)?$", "i");
    return re.test(url.trim());
  }

  function isiKaki() {
    var sos = window.KONFIG.SOSMED && typeof window.KONFIG.SOSMED === "object" ? window.KONFIG.SOSMED : {};
    var daftar = Object.keys(DOMAIN_SOSMED).filter(function (k) {
      return alamatSosmedSah(k, sos[k]);
    });
    var ul = $("#kaki-sosmed");
    ul.replaceChildren.apply(
      ul,
      daftar.map(function (k) {
        return h(
          "li",
          null,
          h("a", { class: "kaki-tautan", href: sos[k].trim(), target: "_blank", rel: "noopener noreferrer", "aria-label": DOMAIN_SOSMED[k].nama + " majelis taklim (tautan keluar)", teks: DOMAIN_SOSMED[k].nama })
        );
      })
    );
    $("#kaki-sosmed-wadah").hidden = !daftar.length;
    var dev = typeof window.KONFIG.PENGEMBANG === "string" && window.KONFIG.PENGEMBANG.trim() ? window.KONFIG.PENGEMBANG.trim() : "Yudi Danton";
    $("#kaki-info").textContent = "Pengembang: " + dev + " · Versi " + VERSI_APLIKASI + " · " + new Date().getFullYear();
  }

  var menuTerbuka = false;
  function aturMenu(buka) {
    var tombol = $("#menu-tombol");
    var daftar = $("#menu-daftar");
    menuTerbuka = !!buka;
    daftar.hidden = !menuTerbuka;
    tombol.setAttribute("aria-expanded", menuTerbuka ? "true" : "false");
    if (menuTerbuka) {
      var pertama = daftar.querySelector("a");
      if (pertama) pertama.focus();
    }
  }

  function pasangMenu() {
    var tombol = $("#menu-tombol");
    var daftar = $("#menu-daftar");
    tombol.addEventListener("click", function (e) {
      e.stopPropagation();
      aturMenu(!menuTerbuka);
    });
    daftar.addEventListener("click", function (e) {
      if (e.target.closest("a")) aturMenu(false);
    });
    document.addEventListener("click", function (e) {
      if (menuTerbuka && !e.target.closest("#menu-daftar") && !e.target.closest("#menu-tombol")) aturMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menuTerbuka) {
        aturMenu(false);
        tombol.focus();
      }
    });
    window.addEventListener("hashchange", function () {
      if (menuTerbuka) aturMenu(false);
    });
  }

  var TAMPILAN = {
    beranda: viewBeranda,
    arisan: viewArisan,
    pengurus: function () {
      return window.Pengurus.buatLayar(window.AlatUI);
    },
    kas: viewKas,
    ibadah: viewIbadah,
    info: viewInfo,
    pengaturan: viewPengaturan,
    sejarah: viewSejarah,
    tentang: viewTentang,
  };

  /* ---------- Penampil lembar omzet (layar penuh) ---------- */
  var P = {
    akar: $("#penampil"),
    tutup: $("#penampil-tutup"),
    petunjuk: $("#penampil-petunjuk"),
    area: $("#penampil-area"),
    gambar: $("#penampil-gambar"),
    kecil: $("#zoom-kecil"),
    besar: $("#zoom-besar"),
    nilai: $("#zoom-nilai"),
  };
  var LEVEL_ZOOM = [1, 1.5, 2, 3, 4];
  var indeksZoom = 0;
  var pembuka = null;

  function aturZoom(i) {
    indeksZoom = Math.max(0, Math.min(LEVEL_ZOOM.length - 1, i));
    P.gambar.style.width = LEVEL_ZOOM[indeksZoom] * 100 + "%";
    P.nilai.textContent = Math.round(LEVEL_ZOOM[indeksZoom] * 100) + "%";
    P.kecil.disabled = indeksZoom === 0;
    P.besar.disabled = indeksZoom === LEVEL_ZOOM.length - 1;
  }

  function bukaPenampil(asal) {
    if (!keadaan.bukuUrl) return;
    pembuka = asal || document.activeElement;
    P.gambar.src = keadaan.bukuUrl;
    var n = keadaan.muat === "siap" ? narikBerlaku() : null;
    if (n) {
      P.petunjuk.textContent = teksPetunjuk(n);
      P.petunjuk.hidden = false;
    } else {
      P.petunjuk.hidden = true;
    }
    aturZoom(0);
    P.akar.hidden = false;
    document.body.style.overflow = "hidden";
    P.area.scrollTo(0, 0);
    history.pushState({ penampil: true }, "");
    P.tutup.focus();
  }

  function tutupPenampil(dariRiwayat) {
    if (P.akar.hidden) return;
    P.akar.hidden = true;
    document.body.style.overflow = "";
    P.gambar.removeAttribute("src");
    if (pembuka && document.contains(pembuka) && pembuka.focus) pembuka.focus();
    if (!dariRiwayat && history.state && history.state.penampil) history.back();
  }

  function jebakFokus(e) {
    if (e.key !== "Tab") return;
    var bisa = [P.tutup, P.area, P.kecil, P.besar].filter(function (el) {
      return !el.disabled;
    });
    var pertama = bisa[0];
    var terakhir = bisa[bisa.length - 1];
    if (e.shiftKey && document.activeElement === pertama) {
      e.preventDefault();
      terakhir.focus();
    } else if (!e.shiftKey && document.activeElement === terakhir) {
      e.preventDefault();
      pertama.focus();
    }
  }

  /* ---------- Pasang di layar utama ---------- */
  function sudahTerpasang() {
    return (
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      navigator.standalone === true
    );
  }

  function perangkatApple() {
    return (
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  function perbaruiPasang() {
    var kotak = $("#pasang");
    if (!kotak) return;
    kotak.replaceChildren();
    if (sudahTerpasang()) {
      kotak.hidden = true;
      return;
    }
    if (keadaan.petaPasang) {
      kotak.append(
        h("p", { teks: "Pasang aplikasi ini di layar utama HP agar bisa dibuka seperti aplikasi biasa." }),
        h(
          "button",
          {
            type: "button",
            class: "tombol tombol-garis",
            on: {
              click: function () {
                var peristiwa = keadaan.petaPasang;
                keadaan.petaPasang = null;
                peristiwa.prompt();
                Promise.resolve(peristiwa.userChoice).catch(function () {}).then(perbaruiPasang);
              },
            },
          },
          "Pasang aplikasi"
        )
      );
      kotak.hidden = false;
    } else if (perangkatApple()) {
      kotak.append(h("p", { teks: "Di iPhone: ketuk tombol Bagikan di Safari, lalu pilih Tambah ke Layar Utama." }));
      kotak.hidden = false;
    } else {
      kotak.hidden = true;
    }
  }

  /* ---------- Tampilan dan perpindahan halaman ---------- */
  function pecahHash() {
    var bagian = location.hash.replace(/^#/, "").split("/");
    var sub = bagian.slice(1).join("/");
    return { rute: bagian[0], sub: /^[a-z0-9-]{1,30}$/.test(sub) ? sub : "" };
  }

  function bacaRute() {
    var nama = pecahHash().rute;
    if (RUTE.indexOf(nama) !== -1) return nama;
    if (!nama) return "beranda";
    return null; // alamat lain (mis. tautan lewati ke isi): tidak berpindah halaman
  }

  function tampil(pindah) {
    var layar = $("#layar");
    layar.replaceChildren(TAMPILAN[ruteSekarang]());

    document.querySelectorAll(".navbawah a[data-tab]").forEach(function (a) {
      if (a.getAttribute("data-tab") === ruteSekarang) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });

    var judulHalaman = ruteSekarang === "beranda" ? NAMA_APLIKASI : JUDUL[ruteSekarang] + " - " + NAMA_APLIKASI;
    if (ruteSekarang === "ibadah" && keadaan.sub && keadaan.zikirBuku.isi && keadaan.zikirBuku.id === keadaan.sub) {
      judulHalaman = keadaan.zikirBuku.isi.judul + " - " + NAMA_APLIKASI;
    }
    document.title = judulHalaman;

    if (ruteSekarang === "beranda") perbaruiPasang();
    if (ruteSekarang !== "info" && keadaan.kompas.aktif) matikanKompas();
    if (ruteSekarang === "info") perbaruiKompas();
    aturPenundaSalat();

    if (pindah) {
      window.scrollTo(0, 0);
      if (sudahMulai) $("#konten").focus({ preventScroll: true });
    }
    gulirKeBagian();
  }

  /* Alamat seperti #kas/donasi dan #info/kiblat membuka halaman lalu menggulir ke bagiannya.
   * Bila bagian belum ada (data masih dimuat), dicoba lagi saat halaman digambar ulang. */
  var BAGIAN_ALAMAT = { kas: { donasi: "judul-donasi" }, info: { kiblat: "kiblat-judul" } };
  function aturGulir() {
    var sub = pecahHash().sub;
    var peta = BAGIAN_ALAMAT[ruteSekarang];
    keadaan.gulir = peta && peta[sub] ? peta[sub] : "";
  }
  function gulirKeBagian() {
    if (!keadaan.gulir) return;
    var el = document.getElementById(keadaan.gulir);
    if (!el) return;
    keadaan.gulir = "";
    el.scrollIntoView({ block: "start" });
  }

  function muatData() {
    keadaan.muat = "memuat";
    tampil(false);
    return window.Data.muat().then(
      function (hasil) {
        keadaan.data = hasil.data;
        keadaan.dariCadangan = hasil.dariCadangan;
        keadaan.waktuCadangan = hasil.waktu;
        keadaan.muat = "siap";
        $("#info-contoh").hidden = !hasil.data.contoh;
        tampil(false);
      },
      function () {
        keadaan.muat = "gagal";
        tampil(false);
      }
    );
  }

  /* Menyegarkan data bersama tanpa menggambar ulang layar (dipakai panel
   * pengurus setelah menyimpan, supaya formulir yang sedang dibuka utuh). */
  function segarkanDiam() {
    return window.Data.muat().then(
      function (hasil) {
        keadaan.data = hasil.data;
        keadaan.dariCadangan = hasil.dariCadangan;
        keadaan.waktuCadangan = hasil.waktu;
        keadaan.muat = "siap";
        $("#info-contoh").hidden = !hasil.data.contoh;
      },
      function () {
        /* gagal: biarkan data yang ada */
      }
    );
  }

  /* Alat yang dipinjamkan ke panel pengurus (js/admin.js). */
  window.AlatUI = {
    h: h,
    toast: toast,
    bacaTanggal: bacaTanggal,
    fmtLengkap: fmtLengkap,
    lokasiDefault: function () {
      return keadaan.data ? keadaan.data.lokasiDefault : "";
    },
    segarkanDiam: segarkanDiam,
  };

  /* ---------- Mulai ---------- */
  function pasangPendengar() {
    pasangMenu();
    isiKaki();
    window.addEventListener("hashchange", function () {
      var rute = bacaRute();
      if (rute === null) return;
      if (!P.akar.hidden) tutupPenampil(true);
      ruteSekarang = rute;
      keadaan.sub = rute === "ibadah" ? pecahHash().sub : "";
      aturGulir();
      keadaan.konfirmasiHapus = false;
      tampil(true);
    });

    window.addEventListener("popstate", function () {
      if (!P.akar.hidden) tutupPenampil(true);
    });

    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      keadaan.petaPasang = e;
      perbaruiPasang();
    });

    window.addEventListener("appinstalled", function () {
      keadaan.petaPasang = null;
      perbaruiPasang();
      toast("Aplikasi sudah terpasang.");
    });

    $("#berkas-foto").addEventListener("change", simpanFotoTerpilih);

    P.tutup.addEventListener("click", function () {
      tutupPenampil(false);
    });
    P.kecil.addEventListener("click", function () {
      aturZoom(indeksZoom - 1);
    });
    P.besar.addEventListener("click", function () {
      aturZoom(indeksZoom + 1);
    });
    P.akar.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        tutupPenampil(false);
      } else {
        jebakFokus(e);
      }
    });
  }

  function daftarkanPekerja() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {
        /* tanpa HTTPS atau di file lokal: aplikasi tetap jalan, hanya tidak offline */
      });
    });
  }

  function mulai() {
    var awal = bacaRute();
    ruteSekarang = awal === null ? "beranda" : awal;
    keadaan.sub = ruteSekarang === "ibadah" ? pecahHash().sub : "";
    aturGulir();
    // alamat dengan bagian tujuan (#info/kiblat): peramban tidak boleh memulihkan posisi gulir lama
    if (keadaan.gulir && "scrollRestoration" in history) history.scrollRestoration = "manual";
    bacaPilihanBaca();
    pasangPendengar();
    tampil(true);
    sudahMulai = true;
    daftarkanPekerja();
    muatBuku().then(function () {
      tampil(false);
    });
    muatData();
  }

  mulai();
})();
