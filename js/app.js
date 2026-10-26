/* Majelis Taklim Al-Istiqomah — logika aplikasi, tahap 1.
 *
 * Isi tahap ini: Beranda (kartu narik malam Jumat, kegiatan berikutnya,
 * pengumuman), halaman Arisan (foto buku besar pribadi di HP anggota), dan
 * penampil foto layar penuh. Kas, Ibadah, dan Info masih halaman persiapan.
 *
 * Aturan yang dipegang:
 *  - Aplikasi tidak membaca nominal dari buku besar. Foto hanya disimpan di
 *    HP anggota dan dibuka oleh anggota itu sendiri.
 *  - Semua teks dari data dipasang lewat textContent, tidak pernah innerHTML.
 */
(function () {
  "use strict";

  var NAMA_APLIKASI = "Majelis Taklim Al-Istiqomah";
  var RUTE = ["beranda", "arisan", "kas", "ibadah", "info"];
  var JUDUL = { beranda: "Beranda", arisan: "Arisan", kas: "Kas", ibadah: "Ibadah", info: "Info" };

  /* ---------- Keadaan ---------- */
  var keadaan = {
    muat: "memuat", // memuat | siap | gagal
    data: null,
    dariCadangan: false,
    waktuCadangan: null,
    buku: null, // rekaman foto buku besar dari IndexedDB, atau null
    bukuUrl: null, // alamat sementara untuk menampilkan foto
    bukuTersedia: true, // false bila HP tidak mengizinkan penyimpanan
    konfirmasiHapus: false,
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
    return { nama: n.nama, noAnggota: n.noAnggota, lokasi: n.lokasi, tanggal: tgl, sisa: sisa };
  }

  function teksPetunjuk(n) {
    if (n.noAnggota !== null) {
      return "Cek baris no. " + n.noAnggota + " di buku besar Anda untuk melihat nominal.";
    }
    return "Cek baris atas nama " + n.nama + " di buku besar Anda untuk melihat nominal.";
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

  /* ---------- Foto buku besar: simpan di HP ---------- */
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
          toast("Buku besar tersimpan di HP ini.");
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
          "Buka buku besar saya"
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
          "Simpan buku besar saya"
        );

    return h(
      "article",
      { class: "narik", "aria-labelledby": "narik-judul" },
      h("h2", { class: "narik-judul", id: "narik-judul", teks: "Narik malam Jumat" }),
      h(
        "p",
        { class: "narik-tanggal" },
        h("time", { datetime: isoTanggal(n.tanggal), teks: fmtLengkap.format(n.tanggal) }),
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
              ? "Buku besar Anda belum disimpan di HP ini. Simpan satu kali, dipakai sampai giliran Anda berikutnya."
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

  function viewBeranda() {
    var akar = h("div", null, h("h1", { class: "sr-only", teks: "Beranda" }), salam(), kartuNarik());

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
        h(
          "section",
          { class: "bagian", "aria-labelledby": "judul-kabar" },
          h("h2", { class: "bagian-judul", id: "judul-kabar", teks: "Pengumuman" }),
          daftarPengumuman()
        )
      );
    }

    akar.append(h("div", { class: "pasang", id: "pasang", hidden: true }));
    return akar;
  }

  /* ---------- Layar: Arisan ---------- */
  function panelBuku() {
    var panel = h(
      "div",
      { class: "panel" },
      h("h2", { class: "panel-judul", teks: "Buku besar saya" }),
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
          "aria-label": "Buka buku besar saya",
          on: {
            click: function (e) {
              bukaPenampil(e.currentTarget);
            },
          },
        },
        h("img", { src: keadaan.bukuUrl, alt: "Pratinjau foto buku besar Anda" })
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
            teks: "Buku besar kertas Anda tidak terpengaruh. Anda bisa memotretnya lagi kapan saja.",
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
            "Buka buku besar"
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
            teks: n.nama + (n.noAnggota !== null ? ", no. anggota " + n.noAnggota : "") + ". " + fmtLengkap.format(n.tanggal) + ".",
          })
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

  var TAMPILAN = {
    beranda: viewBeranda,
    arisan: viewArisan,
    kas: function () {
      return viewSegera("Kas anggota", "Saldo dan catatan kas akan tampil di sini. Bagian ini sedang disiapkan.", "kas");
    },
    ibadah: function () {
      return viewSegera(
        "Zikir tahlil dan tausiyah",
        "Teks zikir tahlil dan arsip tausiyah akan tersedia di sini. Bagian ini sedang disiapkan.",
        "ibadah"
      );
    },
    info: function () {
      return viewSegera(
        "Informasi",
        "Jadwal kegiatan lengkap dan pengumuman akan tampil di sini. Bagian ini sedang disiapkan.",
        "info"
      );
    },
  };

  /* ---------- Penampil buku besar (layar penuh) ---------- */
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
  function bacaRute() {
    var nama = location.hash.replace(/^#/, "");
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

    document.title = ruteSekarang === "beranda" ? NAMA_APLIKASI : JUDUL[ruteSekarang] + " - " + NAMA_APLIKASI;

    if (ruteSekarang === "beranda") perbaruiPasang();

    if (pindah) {
      window.scrollTo(0, 0);
      if (sudahMulai) $("#konten").focus({ preventScroll: true });
    }
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

  /* ---------- Mulai ---------- */
  function pasangPendengar() {
    window.addEventListener("hashchange", function () {
      var rute = bacaRute();
      if (rute === null) return;
      if (!P.akar.hidden) tutupPenampil(true);
      ruteSekarang = rute;
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
