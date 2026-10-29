/* Panel pengurus: masuk dengan akun Google, lalu kelola jadwal narik malam
 * Jumat dan daftar anggota (admin arisan, super admin; tahap 2) serta banner
 * info penting dan ringkasan kajian (admin artikel, super admin; tahap 3).
 *
 * Yang dipegang di sini:
 *  - Aplikasi tidak pernah menentukan siapa boleh apa. Setiap permintaan
 *    membawa token masuk Google ke skrip Apps Script, dan skrip itulah yang
 *    memeriksa email dan perannya. Menyembunyikan panel di sini hanya
 *    kemudahan tampilan, bukan pengamanan.
 *  - Token disimpan di memori saja (hilang saat halaman ditutup).
 *  - Semua teks dari server dipasang lewat textContent, bukan innerHTML.
 *  - Bila ALAMAT_DATA atau GOOGLE_CLIENT_ID belum diisi di config.js,
 *    panel hanya menampilkan petunjuk dan bagian lain aplikasi tetap jalan.
 */
window.Pengurus = (function () {
  "use strict";

  var NAMA_PERAN = {
    super: "Super admin",
    arisan: "Admin arisan",
    kas: "Admin kas",
    artikel: "Admin artikel",
  };
  var BATAS_BARIS_ANGGOTA = 30;

  var U = null; // alat dari app.js (h, toast, tanggal, segarkanDiam, lokasiDefault)
  var akar = null; // elemen layar yang sedang dipakai
  var gsiJanji = null;
  var gsiSiap = false;

  var s = {
    tahap: "awal", // awal | memeriksa | masuk | bukan
    token: null,
    email: "",
    nama: "",
    peran: [],
    induk: null, // [{no, nama}] atau null bila belum dimuat
    jadwal: null, // [{tanggal, no_anggota, nama, lokasi}] atau null
    lokasiBawaan: "",
    cariAnggota: "", // saringan daftar anggota
    ubah: null, // nomor yang sedang diubah, "baru", atau null
    pesanMasuk: "",
    donasi: null, // [{id,judul,keterangan,bank,nomor,atas_nama,qris_url,sampai}] atau null
    ubahDonasi: null,
    hapusDonasi: null,
    kas: null, // [{id,tanggal,jenis,keterangan,jumlah}] atau null
    ubahKas: null, // id catatan kas yang sedang disunting
    hapusKas: null, // id catatan kas yang menunggu konfirmasi hapus
    banner: null, // [{id,jenis,judul,isi,mulai,sampai,status}] atau null
    kajianDaftar: null, // [{jenis,tanggal,judul,penceramah,ringkasan}] atau null
    ubahBanner: null, // id banner yang sedang disunting
    hapusBanner: null, // id banner yang menunggu konfirmasi hapus
    ubahKajian: null, // {jenis,tanggal} yang sedang disunting
    hapusKajian: null, // "jenis|tanggal" yang menunggu konfirmasi hapus
  };

  var JENIS_BANNER = [
    { nilai: "duka", nama: "Duka", lama: 3 },
    { nilai: "penting", nama: "Penting (perubahan jadwal atau lokasi)", lama: 2 },
    { nilai: "umum", nama: "Umum", lama: 7 },
  ];
  var NAMA_STATUS = { tayang: "Tayang", akan: "Belum tayang", selesai: "Selesai" };
  var NAMA_KAJIAN = { tausiyah: "Tausiyah malam Jumat", kajian: "Kajian Ahad pagi" };

  /* ---------- Alat kecil ---------- */
  function tersambung() {
    return !!(window.KONFIG.ALAMAT_DATA && window.KONFIG.GOOGLE_CLIENT_ID);
  }

  function bolehArisan() {
    return s.peran.indexOf("arisan") !== -1 || s.peran.indexOf("super") !== -1;
  }

  function bolehKas() {
    return s.peran.indexOf("kas") !== -1 || s.peran.indexOf("super") !== -1;
  }

  function bolehArtikel() {
    return s.peran.indexOf("artikel") !== -1 || s.peran.indexOf("super") !== -1;
  }

  function tambahHariIso(n) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return awalIso(d);
  }

  function awalIso(d) {
    var bln = String(d.getMonth() + 1).padStart(2, "0");
    var tgl = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + bln + "-" + tgl;
  }

  /* Kamis terdekat (hari ini bila sudah Kamis): malam Jumat jatuh pada Kamis malam. */
  function kamisTerdekat() {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7));
    return d;
  }

  function cari(selektor) {
    return akar ? akar.querySelector(selektor) : null;
  }

  function aturPesan(teks) {
    var el = cari("#pesan-pengurus");
    if (el) el.textContent = teks || "";
  }

  function pesanGalat(g) {
    if (g && g.kode === "jaringan") return "Tidak ada sambungan ke server. Cek internet, lalu coba lagi.";
    if (g && g.kode === "jawaban_salah") return "Jawaban server tidak dikenali. Coba lagi sebentar lagi.";
    return (g && g.message) || "Terjadi kesalahan. Coba lagi.";
  }

  /* ---------- Sambungan ke skrip Apps Script ---------- */
  function kirim(aksi, data) {
    // Content-Type text/plain menghindari pemeriksaan awal (preflight) yang
    // tidak dilayani Apps Script.
    return fetch(window.KONFIG.ALAMAT_DATA, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: s.token, aksi: aksi, data: data || {} }),
    })
      .catch(function () {
        var e = new Error("jaringan");
        e.kode = "jaringan";
        throw e;
      })
      .then(function (res) {
        return res.json().catch(function () {
          var e = new Error("jawaban");
          e.kode = "jawaban_salah";
          throw e;
        });
      })
      .then(function (j) {
        if (!j || j.ok !== true) {
          var e = new Error((j && j.pesan) || "Permintaan ditolak.");
          e.kode = (j && j.kode) || "galat";
          throw e;
        }
        return j;
      });
  }

  /* Galat yang berarti sesi habis: kembali ke layar masuk. */
  function sesiHabis(g) {
    if (g && (g.kode === "belum_masuk" || g.kode === "token_tidak_sah")) {
      keluarDiam();
      s.pesanMasuk = "Sesi berakhir. Masuk lagi dengan akun Google.";
      gambar();
      return true;
    }
    return false;
  }

  /* ---------- Masuk dengan Google ---------- */
  function muatGsi() {
    if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
    if (!gsiJanji) {
      gsiJanji = new Promise(function (selesai, gagal) {
        var sk = document.createElement("script");
        sk.src = "https://accounts.google.com/gsi/client";
        sk.async = true;
        sk.onload = function () {
          selesai();
        };
        sk.onerror = function () {
          gsiJanji = null;
          gagal(new Error("gsi"));
        };
        document.head.append(sk);
      });
    }
    return gsiJanji;
  }

  function pasangTombolGoogle() {
    var wadah = cari("#tombol-google");
    if (!wadah) return;
    muatGsi().then(
      function () {
        if (!gsiSiap) {
          window.google.accounts.id.initialize({
            client_id: window.KONFIG.GOOGLE_CLIENT_ID,
            callback: setelahMasuk,
            auto_select: false,
            cancel_on_tap_outside: true,
          });
          gsiSiap = true;
        }
        wadah.replaceChildren();
        window.google.accounts.id.renderButton(wadah, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "rectangular",
          locale: "id",
          width: 280,
        });
      },
      function () {
        aturPesan("Tombol masuk Google tidak bisa dimuat. Cek sambungan internet, lalu buka ulang halaman ini.");
      }
    );
  }

  function setelahMasuk(jawaban) {
    if (!jawaban || !jawaban.credential) return;
    s.token = jawaban.credential;
    s.tahap = "memeriksa";
    s.pesanMasuk = "";
    gambar();
    kirim("saya").then(
      function (r) {
        s.email = r.email || "";
        s.nama = r.nama || "";
        s.peran = Array.isArray(r.peran) ? r.peran : [];
        s.tahap = "masuk";
        gambar();
      },
      function (g) {
        if (g && g.kode === "bukan_pengurus") {
          s.tahap = "bukan";
          s.pesanMasuk = g.message;
          s.token = null;
          gambar();
          return;
        }
        s.tahap = "awal";
        s.token = null;
        s.pesanMasuk = pesanGalat(g);
        gambar();
      }
    );
  }

  function keluarDiam() {
    s.token = null;
    s.email = "";
    s.nama = "";
    s.peran = [];
    s.induk = null;
    s.jadwal = null;
    s.ubah = null;
    s.cariAnggota = "";
    s.donasi = null;
    s.ubahDonasi = null;
    s.hapusDonasi = null;
    s.kas = null;
    s.ubahKas = null;
    s.hapusKas = null;
    s.banner = null;
    s.kajianDaftar = null;
    s.ubahBanner = null;
    s.hapusBanner = null;
    s.ubahKajian = null;
    s.hapusKajian = null;
    s.tahap = "awal";
    try {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.disableAutoSelect();
      }
    } catch (e) {
      /* abaikan */
    }
  }

  function keluar() {
    keluarDiam();
    s.pesanMasuk = "";
    gambar();
    U.toast("Anda sudah keluar.");
  }

  /* ---------- Data arisan ---------- */
  var sedangMemuat = null;

  function muatDataArisan() {
    if (sedangMemuat) return sedangMemuat;
    sedangMemuat = Promise.all([kirim("induk.daftar"), kirim("narik.daftar")]).then(
      function (hasil) {
        sedangMemuat = null;
        s.induk = hasil[0].induk || [];
        s.jadwal = hasil[1].jadwal || [];
        s.lokasiBawaan = hasil[1].lokasi_default || U.lokasiDefault() || "";
        isiKetergantungan();
      },
      function (g) {
        sedangMemuat = null;
        if (sesiHabis(g)) return;
        aturPesan(pesanGalat(g) + " Buka ulang halaman ini untuk memuat daftar lagi.");
        var dj = cari("#daftar-jadwal");
        if (dj && s.jadwal === null) dj.textContent = "Daftar belum bisa dimuat.";
        var da = cari("#daftar-anggota");
        if (da && s.induk === null) da.textContent = "Daftar belum bisa dimuat.";
      }
    );
    return sedangMemuat;
  }

  function isiKetergantungan() {
    isiWaktuBawaan();
    isiKet();
    isiPilihan();
    isiDaftarJadwal();
    isiDaftarAnggota();
  }

  /* Waktu narik biasanya sama tiap pekan: isi bawaan dari jadwal tersimpan yang ada. */
  function isiWaktuBawaan() {
    var kolom = cari("#f-waktu");
    if (!kolom || kolom.value || kolom.getAttribute("data-disentuh") === "1" || !s.jadwal) return;
    for (var i = 0; i < s.jadwal.length; i++) {
      if (s.jadwal[i].waktu) {
        kolom.value = s.jadwal[i].waktu;
        return;
      }
    }
  }

  function isiKet() {
    var el = cari("#ket-lokasi");
    if (el) {
      var lokasi = s.lokasiBawaan || U.lokasiDefault();
      el.textContent = lokasi ? "Lokasi bawaan: " + lokasi + "." : "";
    }
  }

  /* ---------- Layar ---------- */
  function panelAkun() {
    var h = U.h;
    return h(
      "div",
      { class: "panel" },
      h("h2", { class: "panel-judul", teks: s.nama || "Akun pengurus" }),
      h("p", { class: "panel-ket", teks: s.email }),
      h(
        "p",
        { class: "peran-baris" },
        s.peran.map(function (p) {
          return h("span", { class: "peran-chip", teks: NAMA_PERAN[p] || p });
        })
      ),
      h("div", { class: "aksi" }, h("button", { type: "button", class: "tombol tombol-garis", on: { click: keluar } }, "Keluar"))
    );
  }

  function panelMasuk() {
    var h = U.h;
    return h(
      "div",
      { class: "panel" },
      h("h2", { class: "panel-judul", teks: "Masuk sebagai pengurus" }),
      h("p", {
        class: "panel-ket",
        teks: "Gunakan akun Google yang didaftarkan super admin. Anggota biasa tidak perlu masuk.",
      }),
      h("div", { id: "tombol-google", class: "tombol-google" }),
      s.pesanMasuk ? h("p", { class: "status-pesan", teks: s.pesanMasuk }) : null
    );
  }

  function panelBukan() {
    var h = U.h;
    return h(
      "div",
      { class: "panel" },
      h("h2", { class: "panel-judul", teks: "Akun ini bukan pengurus" }),
      h("p", { class: "panel-ket", teks: s.pesanMasuk || "Akun Google ini belum didaftarkan sebagai pengurus." }),
      h(
        "div",
        { class: "aksi" },
        h(
          "button",
          {
            type: "button",
            class: "tombol tombol-garis",
            on: {
              click: function () {
                keluarDiam();
                s.pesanMasuk = "";
                gambar();
              },
            },
          },
          "Coba akun lain"
        )
      )
    );
  }

  function panelBelumTersedia() {
    var h = U.h;
    var nama = s.peran
      .map(function (p) {
        return NAMA_PERAN[p] || p;
      })
      .join(", ");
    return h(
      "div",
      { class: "panel" },
      h("h2", { class: "panel-judul", teks: "Menu untuk peran Anda belum tersedia" }),
      h("p", { class: "panel-ket", teks: "Peran Anda: " + nama + ". Menu untuk peran ini sedang disiapkan." })
    );
  }

  function panelJadwal() {
    var h = U.h;
    var saran = kamisTerdekat();
    var bantu =
      "Malam Jumat jatuh pada Kamis malam. Tanggal yang disarankan: " + U.fmtLengkap.format(saran) + ".";

    var form = h(
      "form",
      { id: "form-jadwal", novalidate: true, on: { submit: simpanJadwal } },
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "f-tgl", teks: "Tanggal" }),
        h("input", { class: "isian", type: "date", id: "f-tgl", required: true, min: awalIso(new Date()), value: awalIso(saran), "aria-describedby": "f-tgl-ket" }),
        h("p", { class: "bantu", id: "f-tgl-ket", teks: bantu })
      ),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "f-cari", teks: "Anggota yang narik" }),
        h("input", {
          class: "isian",
          type: "search",
          id: "f-cari",
          placeholder: "Cari nama atau nomor",
          autocomplete: "off",
          on: { input: isiPilihan },
        }),
        h("select", { class: "isian pilihan", id: "f-anggota", size: "6", "aria-label": "Pilih anggota yang narik" })
      ),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "f-waktu", teks: "Waktu (opsional)" }),
        h("input", {
          class: "isian",
          type: "text",
          id: "f-waktu",
          maxlength: "40",
          autocomplete: "off",
          placeholder: "Contoh: Ba'da Isya",
          on: {
            input: function (e) {
              e.target.setAttribute("data-disentuh", "1");
            },
          },
        })
      ),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "f-lokasi", teks: "Lokasi (opsional)" }),
        h("input", {
          class: "isian",
          type: "text",
          id: "f-lokasi",
          maxlength: "120",
          autocomplete: "off",
          placeholder: "Kosongkan untuk memakai lokasi bawaan",
          "aria-describedby": "ket-lokasi",
        }),
        h("p", { class: "bantu", id: "ket-lokasi" })
      ),
      h("button", { type: "submit", class: "tombol tombol-penuh", id: "f-simpan" }, "Simpan jadwal")
    );

    return h(
      "section",
      { class: "panel", "aria-labelledby": "jd-judul" },
      h("h2", { class: "panel-judul", id: "jd-judul", teks: "Jadwal narik malam Jumat" }),
      h("p", { class: "panel-ket", teks: "Aplikasi menampilkan jadwal terdekat yang belum lewat kepada semua anggota." }),
      form,
      h("h3", { class: "kelompok-judul", teks: "Jadwal tersimpan" }),
      h("div", { id: "daftar-jadwal" }, h("p", { class: "catatan", teks: "Memuat..." }))
    );
  }

  function panelAnggota() {
    var h = U.h;
    return h(
      "section",
      { class: "panel", "aria-labelledby": "ag-judul" },
      h("h2", { class: "panel-judul", id: "ag-judul", teks: "Daftar anggota" }),
      h("p", {
        class: "panel-ket",
        teks: "Ganti nama pada nomor yang anggotanya berganti. Nomor tidak berubah. Jadwal yang sudah tersimpan tetap memakai nama saat disimpan.",
      }),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "a-cari", teks: "Cari anggota" }),
        h("input", {
          class: "isian",
          type: "search",
          id: "a-cari",
          placeholder: "Nama atau nomor",
          autocomplete: "off",
          on: {
            input: function (e) {
              s.cariAnggota = e.target.value;
              isiDaftarAnggota();
            },
          },
        })
      ),
      h("div", { id: "daftar-anggota" }, h("p", { class: "catatan", teks: "Memuat..." })),
      h(
        "div",
        { class: "aksi" },
        h(
          "button",
          {
            type: "button",
            class: "tombol tombol-garis",
            id: "tambah-anggota",
            on: {
              click: function () {
                s.ubah = "baru";
                isiDaftarAnggota();
                var kolom = cari("#ubah-nama");
                if (kolom) kolom.focus();
              },
            },
          },
          "Tambah anggota baru"
        )
      )
    );
  }

  function gambar() {
    if (!akar) return;
    var h = U.h;
    var isi = [h("h1", { class: "bagian-judul", teks: "Pengurus" })];

    if (!tersambung()) {
      isi.push(
        h(
          "div",
          { class: "panel" },
          h("h2", { class: "panel-judul", teks: "Belum tersambung" }),
          h("p", {
            class: "panel-ket",
            teks: "Bagian pengurus akan aktif setelah alamat skrip data dan ID klien Google diisi di js/config.js. Bagian lain aplikasi tetap bisa dipakai.",
          })
        )
      );
    } else if (s.tahap === "awal") {
      isi.push(panelMasuk());
    } else if (s.tahap === "memeriksa") {
      isi.push(h("div", { class: "panel" }, h("p", { class: "panel-ket", teks: "Memeriksa akun Anda..." })));
    } else if (s.tahap === "bukan") {
      isi.push(panelBukan());
    } else {
      isi.push(panelAkun());
      if (bolehArisan()) isi.push(panelJadwal(), panelAnggota());
      if (bolehKas()) isi.push(panelKas(), panelDonasi());
      if (bolehArtikel()) isi.push(panelBanner(), panelKajian());
      if (!bolehArisan() && !bolehArtikel() && !bolehKas()) isi.push(panelBelumTersedia());
    }

    isi.push(h("p", { id: "pesan-pengurus", class: "status-pesan", role: "status", "aria-live": "polite" }));
    akar.replaceChildren.apply(akar, isi);

    if (tersambung() && s.tahap === "awal") pasangTombolGoogle();
    if (s.tahap === "masuk" && bolehArisan()) {
      if (s.induk === null || s.jadwal === null) muatDataArisan();
      else isiKetergantungan();
    }
    if (s.tahap === "masuk" && bolehKas()) {
      if (s.kas === null) muatDataKas();
      else isiDaftarKas();
      if (s.donasi === null) muatDataDonasi();
      else isiDaftarDonasi();
    }
    if (s.tahap === "masuk" && bolehArtikel()) {
      bantuJenisBanner();
      if (s.banner === null || s.kajianDaftar === null) muatDataArtikel();
      else isiArtikel();
    }
  }

  /* ---------- Pilihan anggota & daftar ---------- */
  function cocok(a, kata) {
    if (!kata) return true;
    return String(a.no) === kata || (String(a.no) + ". " + a.nama).toLowerCase().indexOf(kata) !== -1;
  }

  function isiPilihan() {
    var pilih = cari("#f-anggota");
    if (!pilih) return;
    var kata = (cari("#f-cari") ? cari("#f-cari").value : "").trim().toLowerCase();
    var terpilih = pilih.value;
    pilih.replaceChildren();
    (s.induk || []).forEach(function (a) {
      if (!a.nama || !cocok(a, kata)) return;
      var opsi = document.createElement("option");
      opsi.value = String(a.no);
      opsi.textContent = a.no + ". " + a.nama;
      pilih.append(opsi);
    });
    if (terpilih) pilih.value = terpilih;
    if (s.induk === null) {
      var memuat = document.createElement("option");
      memuat.disabled = true;
      memuat.textContent = "Memuat daftar anggota...";
      pilih.append(memuat);
    }
  }

  function isiDaftarJadwal() {
    var wadah = cari("#daftar-jadwal");
    if (!wadah) return;
    var h = U.h;
    if (s.jadwal === null) return;
    if (!s.jadwal.length) {
      wadah.replaceChildren(h("p", { class: "catatan", teks: "Belum ada jadwal mendatang." }));
      return;
    }
    wadah.replaceChildren(
      h(
        "ul",
        { class: "daftar" },
        s.jadwal.map(function (j) {
          var tgl = U.bacaTanggal(j.tanggal);
          return h(
            "li",
            { class: "baris-daftar" },
            h(
              "div",
              { class: "baris-teks" },
              h("p", { class: "kegiatan-nama", teks: j.nama + " (no. " + j.no_anggota + ")" }),
              h("p", { class: "kegiatan-ket", teks: (tgl ? U.fmtLengkap.format(tgl) : j.tanggal) + (j.waktu ? ", " + j.waktu : "") + ". " + (j.lokasi || "Lokasi bawaan") })
            ),
            h(
              "button",
              {
                type: "button",
                class: "tombol tombol-kecil tombol-garis",
                "aria-label": "Ubah jadwal " + j.nama,
                on: {
                  click: function () {
                    muatKeForm(j);
                  },
                },
              },
              "Ubah"
            )
          );
        })
      )
    );
  }

  function muatKeForm(j) {
    var tgl = cari("#f-tgl");
    var lok = cari("#f-lokasi");
    var cariKolom = cari("#f-cari");
    if (!tgl) return;
    tgl.value = j.tanggal;
    lok.value = j.lokasi || "";
    cari("#f-waktu").value = j.waktu || "";
    cariKolom.value = "";
    isiPilihan();
    cari("#f-anggota").value = String(j.no_anggota);
    aturPesan("Data dimasukkan ke formulir. Ubah lalu simpan.");
    tgl.scrollIntoView({ block: "center" });
    tgl.focus();
  }

  function simpanJadwal(e) {
    e.preventDefault();
    var tombol = cari("#f-simpan");
    var tanggal = cari("#f-tgl").value;
    var no = cari("#f-anggota").value;
    var lokasi = cari("#f-lokasi").value;
    var waktuNarik = cari("#f-waktu").value;

    if (!tanggal) return aturPesan("Isi tanggal terlebih dahulu.");
    if (tanggal < awalIso(new Date())) return aturPesan("Tanggal sudah lewat. Pilih hari ini atau sesudahnya.");
    if (!no) return aturPesan("Pilih anggota yang narik dari daftar.");

    aturPesan("");
    tombol.disabled = true;
    kirim("narik.simpan", { tanggal: tanggal, no_anggota: Number(no), lokasi: lokasi, waktu: waktuNarik }).then(
      function (r) {
        tombol.disabled = false;
        var tgl = U.bacaTanggal(r.tanggal);
        var teks = "Jadwal tersimpan: " + r.nama + ", " + (tgl ? U.fmtLengkap.format(tgl) : r.tanggal) + ".";
        aturPesan(teks);
        U.toast(r.diganti ? "Jadwal tanggal itu diperbarui." : "Jadwal tersimpan.");
        U.segarkanDiam();
        kirim("narik.daftar").then(
          function (d) {
            s.jadwal = d.jadwal || [];
            isiDaftarJadwal();
          },
          function () {}
        );
      },
      function (g) {
        tombol.disabled = false;
        if (sesiHabis(g)) return;
        aturPesan(pesanGalat(g));
      }
    );
  }

  function isiDaftarAnggota() {
    var wadah = cari("#daftar-anggota");
    if (!wadah) return;
    var h = U.h;
    if (s.induk === null) return;

    var kata = s.cariAnggota.trim().toLowerCase();
    var semua = s.induk.filter(function (a) {
      return cocok(a, kata);
    });
    var tampil = semua.slice(0, BATAS_BARIS_ANGGOTA);
    var terbesar = s.induk.reduce(function (m, a) {
      return a.no > m ? a.no : m;
    }, 0);

    var butir = [];
    if (s.ubah === "baru") {
      butir.push(h("li", { class: "baris-ubah" }, formUbah(terbesar + 1, "", true)));
    }
    tampil.forEach(function (a) {
      if (s.ubah === a.no) {
        butir.push(h("li", { class: "baris-ubah" }, formUbah(a.no, a.nama, false)));
        return;
      }
      butir.push(
        h(
          "li",
          { class: "baris-daftar" },
          h("div", { class: "baris-teks" }, h("p", { class: a.nama ? "" : "catatan", teks: a.no + ". " + (a.nama || "(kosong)") })),
          h(
            "button",
            {
              type: "button",
              class: "tombol tombol-kecil tombol-garis",
              "aria-label": "Ubah nama nomor " + a.no,
              on: {
                click: function () {
                  s.ubah = a.no;
                  isiDaftarAnggota();
                  var kolom = cari("#ubah-nama");
                  if (kolom) kolom.focus();
                },
              },
            },
            "Ubah"
          )
        )
      );
    });

    var isi = [];
    if (butir.length) isi.push(h("ul", { class: "daftar" }, butir));
    if (!semua.length && s.ubah !== "baru") isi.push(h("p", { class: "catatan", teks: "Tidak ada anggota yang cocok." }));
    if (semua.length > tampil.length) {
      isi.push(h("p", { class: "catatan", teks: "Menampilkan " + tampil.length + " dari " + semua.length + ". Persempit pencarian untuk melihat yang lain." }));
    }
    wadah.replaceChildren.apply(wadah, isi);
  }

  function formUbah(no, nama, baru) {
    var h = U.h;
    return h(
      "form",
      {
        class: "form-ubah",
        novalidate: true,
        on: {
          submit: function (e) {
            e.preventDefault();
            simpanAnggota(no, cari("#ubah-nama").value, baru);
          },
        },
      },
      h("label", { for: "ubah-nama", teks: baru ? "Nama anggota baru (nomor " + no + ")" : "Nama untuk nomor " + no }),
      h("input", { class: "isian", id: "ubah-nama", type: "text", maxlength: "60", autocomplete: "off", value: nama }),
      h(
        "div",
        { class: "aksi aksi-dua" },
        h(
          "button",
          {
            type: "button",
            class: "tombol tombol-garis",
            on: {
              click: function () {
                s.ubah = null;
                aturPesan("");
                isiDaftarAnggota();
              },
            },
          },
          "Batal"
        ),
        h("button", { type: "submit", class: "tombol", id: "ubah-simpan" }, "Simpan")
      )
    );
  }

  function simpanAnggota(no, nama, baru) {
    nama = String(nama || "").trim();
    if (!nama) return aturPesan("Isi nama anggota terlebih dahulu.");
    var tombol = cari("#ubah-simpan");
    if (tombol) tombol.disabled = true;
    aturPesan("");
    kirim("induk.simpan", { no: no, nama: nama }).then(
      function () {
        s.ubah = null;
        U.toast(baru ? "Anggota baru ditambahkan." : "Nama diperbarui.");
        return kirim("induk.daftar").then(function (d) {
          s.induk = d.induk || [];
          // Saringan diganti dengan nama yang baru disimpan, supaya barisnya
          // tetap terlihat (dengan saringan lama baris itu bisa hilang dari daftar).
          s.cariAnggota = nama;
          var kolomCari = cari("#a-cari");
          if (kolomCari) kolomCari.value = nama;
          isiPilihan();
          isiDaftarAnggota();
          aturPesan("Tersimpan: nomor " + no + ", " + nama + ".");
        });
      },
      function (g) {
        if (tombol) tombol.disabled = false;
        if (sesiHabis(g)) return;
        aturPesan(pesanGalat(g));
      }
    );
  }

  /* ---------- Catatan kas (admin kas) ---------- */
  var sedangMemuatKas = null;
  var fmtRupiah = new Intl.NumberFormat("id-ID");

  function muatDataKas() {
    if (sedangMemuatKas) return sedangMemuatKas;
    sedangMemuatKas = kirim("kas.daftar").then(
      function (d) {
        sedangMemuatKas = null;
        s.kas = d.kas || [];
        isiDaftarKas();
      },
      function (g) {
        sedangMemuatKas = null;
        if (sesiHabis(g)) return;
        aturPesanDi("#pesan-kas", pesanGalat(g) + " Buka ulang halaman ini untuk memuat daftar lagi.");
        var w = cari("#daftar-kas");
        if (w && s.kas === null) w.textContent = "Daftar belum bisa dimuat.";
      }
    );
    return sedangMemuatKas;
  }

  function panelKas() {
    var h = U.h;
    var form = h(
      "form",
      { id: "form-kas", novalidate: true, on: { submit: simpanKas } },
      h(
        "div",
        { class: "bidang dua-kolom" },
        h(
          "div",
          null,
          h("label", { for: "ks-jenis", teks: "Jenis" }),
          h(
            "select",
            { class: "isian", id: "ks-jenis" },
            h("option", { value: "masuk", teks: "Pemasukan" }),
            h("option", { value: "keluar", teks: "Pengeluaran" })
          )
        ),
        h(
          "div",
          null,
          h("label", { for: "ks-tanggal", teks: "Tanggal" }),
          h("input", { class: "isian", type: "date", id: "ks-tanggal", value: tambahHariIso(0), max: tambahHariIso(0) })
        )
      ),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "ks-ket", teks: "Keterangan" }),
        h("input", {
          class: "isian",
          type: "text",
          id: "ks-ket",
          maxlength: "100",
          autocomplete: "off",
          placeholder: "Contoh: Iuran kas pekan ini, atau Beli air galon",
        })
      ),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "ks-jumlah", teks: "Jumlah (rupiah)" }),
        h("input", {
          class: "isian",
          type: "text",
          inputmode: "numeric",
          id: "ks-jumlah",
          autocomplete: "off",
          placeholder: "Contoh: 150000",
          "aria-describedby": "ks-jumlah-ket",
        }),
        h("p", { class: "bantu", id: "ks-jumlah-ket", teks: "Angka saja, tanpa Rp. Titik pemisah ribuan boleh." })
      ),
      h(
        "div",
        { class: "aksi aksi-dua" },
        h("button", { type: "submit", class: "tombol", id: "ks-simpan" }, "Simpan catatan"),
        h(
          "button",
          { type: "button", class: "tombol tombol-garis", id: "ks-batal", hidden: true, on: { click: batalUbahKas } },
          "Batal ubah"
        )
      )
    );
    return h(
      "section",
      { class: "panel", "aria-labelledby": "ks-judul" },
      h("h2", { class: "panel-judul", id: "ks-judul", teks: "Catatan kas" }),
      h("p", {
        class: "panel-ket",
        teks: "Saldo dan pemasukan pekan ini dihitung otomatis dari catatan di bawah, lalu tampil di halaman Kas untuk semua anggota. Cukup catat total pemasukan tiap pekan, tidak per anggota.",
      }),
      form,
      h("p", { id: "pesan-kas", class: "status-pesan", role: "status", "aria-live": "polite" }),
      h("h3", { class: "kelompok-judul", teks: "Catatan terbaru" }),
      h("div", { id: "daftar-kas" }, h("p", { class: "catatan", teks: "Memuat..." }))
    );
  }

  function kosongkanFormKas() {
    s.ubahKas = null;
    if (!cari("#form-kas")) return;
    cari("#ks-jenis").value = "masuk";
    cari("#ks-tanggal").value = tambahHariIso(0);
    cari("#ks-ket").value = "";
    cari("#ks-jumlah").value = "";
    cari("#ks-simpan").textContent = "Simpan catatan";
    cari("#ks-batal").hidden = true;
  }

  function batalUbahKas() {
    kosongkanFormKas();
    aturPesanDi("#pesan-kas", "");
  }

  function muatKasKeForm(k) {
    if (!cari("#form-kas")) return;
    s.ubahKas = k.id;
    cari("#ks-jenis").value = k.jenis;
    cari("#ks-tanggal").value = k.tanggal;
    cari("#ks-ket").value = k.keterangan;
    cari("#ks-jumlah").value = String(k.jumlah);
    cari("#ks-simpan").textContent = "Simpan perubahan";
    cari("#ks-batal").hidden = false;
    aturPesanDi("#pesan-kas", "Catatan dimasukkan ke formulir. Ubah lalu simpan.");
    cari("#ks-ket").scrollIntoView({ block: "center" });
    cari("#ks-ket").focus();
  }

  function simpanKas(e) {
    e.preventDefault();
    var tombol = cari("#ks-simpan");
    var masukan = {
      id: s.ubahKas || "",
      jenis: cari("#ks-jenis").value,
      tanggal: cari("#ks-tanggal").value,
      keterangan: cari("#ks-ket").value,
      jumlah: cari("#ks-jumlah").value.trim(),
    };
    if (!masukan.tanggal) return aturPesanDi("#pesan-kas", "Isi tanggal terlebih dahulu.");
    if (masukan.tanggal > tambahHariIso(0)) return aturPesanDi("#pesan-kas", "Tanggal tidak boleh di masa depan.");
    if (!masukan.keterangan.trim()) return aturPesanDi("#pesan-kas", "Isi keterangan terlebih dahulu.");
    if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(masukan.jumlah) || Number(masukan.jumlah.replace(/\./g, "")) < 1) {
      return aturPesanDi("#pesan-kas", "Isi jumlah dengan angka rupiah, misalnya 150000.");
    }

    aturPesanDi("#pesan-kas", "");
    tombol.disabled = true;
    kirim("kas.simpan", masukan).then(
      function (r) {
        tombol.disabled = false;
        kosongkanFormKas();
        var pesan = r.diganti ? "Catatan kas diperbarui." : "Catatan kas tersimpan.";
        aturPesanDi("#pesan-kas", pesan);
        U.toast(pesan);
        U.segarkanDiam();
        return muatUlangKas();
      },
      function (g) {
        tombol.disabled = false;
        if (sesiHabis(g)) return;
        aturPesanDi("#pesan-kas", pesanGalat(g));
      }
    );
  }

  function muatUlangKas() {
    return kirim("kas.daftar").then(
      function (d) {
        s.kas = d.kas || [];
        isiDaftarKas();
      },
      function () {}
    );
  }

  function hapusKasTerpilih(id) {
    kirim("kas.hapus", { id: id }).then(
      function () {
        s.hapusKas = null;
        if (s.ubahKas === id) kosongkanFormKas();
        aturPesanDi("#pesan-kas", "Catatan kas dihapus.");
        U.toast("Catatan kas dihapus.");
        U.segarkanDiam();
        return muatUlangKas();
      },
      function (g) {
        if (sesiHabis(g)) return;
        s.hapusKas = null;
        aturPesanDi("#pesan-kas", pesanGalat(g));
        isiDaftarKas();
      }
    );
  }

  function isiDaftarKas() {
    var wadah = cari("#daftar-kas");
    if (!wadah || s.kas === null) return;
    var h = U.h;
    if (!s.kas.length) {
      wadah.replaceChildren(h("p", { class: "catatan", teks: "Belum ada catatan kas." }));
      return;
    }
    wadah.replaceChildren(
      h(
        "ul",
        { class: "daftar" },
        s.kas.map(function (k) {
          var menunggu = s.hapusKas === k.id;
          var tanda = k.jenis === "masuk" ? "+ " : "- ";
          var nama = (k.jenis === "masuk" ? "Pemasukan" : "Pengeluaran") + " " + k.keterangan;
          return h(
            "li",
            { class: "baris-daftar tumpuk" },
            h(
              "div",
              { class: "baris-teks" },
              h("p", { class: "kegiatan-nama", teks: k.keterangan }),
              h("p", { class: "kegiatan-ket", teks: (k.jenis === "masuk" ? "Pemasukan" : "Pengeluaran") + ". " + ketTanggal(k.tanggal) + ". " + tanda + "Rp " + fmtRupiah.format(k.jumlah) })
            ),
            menunggu
              ? h(
                  "div",
                  { class: "konfirmasi-baris", role: "alertdialog", "aria-label": "Konfirmasi hapus catatan kas " + k.keterangan },
                  h("p", { teks: "Hapus catatan ini? Saldo akan ikut berubah." }),
                  h(
                    "div",
                    { class: "aksi aksi-dua" },
                    h("button", { type: "button", class: "tombol tombol-garis", on: { click: function () { s.hapusKas = null; isiDaftarKas(); } } }, "Batal"),
                    h("button", { type: "button", class: "tombol tombol-bahaya", on: { click: function () { hapusKasTerpilih(k.id); } } }, "Hapus")
                  )
                )
              : h(
                  "div",
                  { class: "aksi-baris" },
                  h("button", { type: "button", class: "tombol tombol-kecil tombol-garis", "aria-label": "Ubah " + nama, on: { click: function () { muatKasKeForm(k); } } }, "Ubah"),
                  h("button", { type: "button", class: "tombol tombol-kecil tombol-garis", "aria-label": "Hapus " + nama, on: { click: function () { s.hapusKas = k.id; isiDaftarKas(); } } }, "Hapus")
                )
          );
        })
      )
    );
  }

  /* ---------- Saluran infaq (admin kas) ---------- */
  var sedangMemuatDonasi = null;

  function muatDataDonasi() {
    if (sedangMemuatDonasi) return sedangMemuatDonasi;
    sedangMemuatDonasi = kirim("donasi.daftar").then(
      function (d) {
        sedangMemuatDonasi = null;
        s.donasi = d.donasi || [];
        isiDaftarDonasi();
      },
      function (g) {
        sedangMemuatDonasi = null;
        if (sesiHabis(g)) return;
        aturPesanDi("#pesan-donasi", pesanGalat(g) + " Buka ulang halaman ini untuk memuat daftar lagi.");
        var w = cari("#daftar-donasi-admin");
        if (w && s.donasi === null) w.textContent = "Daftar belum bisa dimuat.";
      }
    );
    return sedangMemuatDonasi;
  }

  function bidangTeks(id, label, opsi) {
    var h = U.h;
    opsi = opsi || {};
    return h(
      "div",
      { class: "bidang" },
      h("label", { for: id, teks: label }),
      h("input", {
        class: "isian",
        type: opsi.tipe || "text",
        id: id,
        maxlength: opsi.maks || "100",
        autocomplete: "off",
        inputmode: opsi.mode || null,
        placeholder: opsi.contoh || null,
        "aria-describedby": opsi.bantu ? id + "-ket" : null,
      }),
      opsi.bantu ? h("p", { class: "bantu", id: id + "-ket", teks: opsi.bantu }) : null
    );
  }

  function panelDonasi() {
    var h = U.h;
    var form = h(
      "form",
      { id: "form-donasi", novalidate: true, on: { submit: simpanDonasi } },
      bidangTeks("dn-judul", "Judul", { maks: "80", contoh: "Contoh: Infaq majelis" }),
      bidangTeks("dn-ket", "Keterangan (opsional)", { maks: "300" }),
      bidangTeks("dn-bank", "Nama bank", { maks: "40", contoh: "Contoh: BSI" }),
      bidangTeks("dn-nomor", "Nomor rekening", { maks: "32", mode: "numeric", bantu: "Angka saja (spasi atau strip boleh). Kosongkan bila hanya memakai QRIS." }),
      bidangTeks("dn-nama", "Atas nama", { maks: "60" }),
      bidangTeks("dn-qris", "Alamat gambar QRIS (opsional)", {
        tipe: "url",
        maks: "300",
        contoh: "https://...",
        bantu: "Harus diawali https://. Gambar disimpan di tempat lain (mis. folder aplikasi di GitHub); aplikasi hanya menampilkannya.",
      }),
      bidangTeks("dn-sampai", "Tayang sampai (opsional)", { tipe: "date", maks: "10", bantu: "Kosong = tayang terus sampai dihapus." }),
      h(
        "div",
        { class: "aksi aksi-dua" },
        h("button", { type: "submit", class: "tombol", id: "dn-simpan" }, "Simpan saluran"),
        h("button", { type: "button", class: "tombol tombol-garis", id: "dn-batal", hidden: true, on: { click: batalUbahDonasi } }, "Batal ubah")
      )
    );
    return h(
      "section",
      { class: "panel", "aria-labelledby": "dn-panel-judul" },
      h("h2", { class: "panel-judul", id: "dn-panel-judul", teks: "Infaq" }),
      h("p", {
        class: "panel-ket",
        teks: "Rekening dan QRIS yang tampil di halaman Kas. Periksa nomor dengan teliti: setiap perubahan tercatat lengkap di Log beserta nomor lama dan barunya.",
      }),
      form,
      h("p", { id: "pesan-donasi", class: "status-pesan", role: "status", "aria-live": "polite" }),
      h("h3", { class: "kelompok-judul", teks: "Saluran tersimpan" }),
      h("div", { id: "daftar-donasi-admin" }, h("p", { class: "catatan", teks: "Memuat..." }))
    );
  }

  var BIDANG_DONASI = ["judul", "ket", "bank", "nomor", "nama", "qris", "sampai"];

  function kosongkanFormDonasi() {
    s.ubahDonasi = null;
    if (!cari("#form-donasi")) return;
    BIDANG_DONASI.forEach(function (k) {
      cari("#dn-" + k).value = "";
    });
    cari("#dn-simpan").textContent = "Simpan saluran";
    cari("#dn-batal").hidden = true;
  }

  function batalUbahDonasi() {
    kosongkanFormDonasi();
    aturPesanDi("#pesan-donasi", "");
  }

  function muatDonasiKeForm(d) {
    if (!cari("#form-donasi")) return;
    s.ubahDonasi = d.id;
    cari("#dn-judul").value = d.judul;
    cari("#dn-ket").value = d.keterangan;
    cari("#dn-bank").value = d.bank;
    cari("#dn-nomor").value = d.nomor;
    cari("#dn-nama").value = d.atas_nama;
    cari("#dn-qris").value = d.qris_url;
    cari("#dn-sampai").value = d.sampai;
    cari("#dn-simpan").textContent = "Simpan perubahan";
    cari("#dn-batal").hidden = false;
    aturPesanDi("#pesan-donasi", "Data dimasukkan ke formulir. Ubah lalu simpan.");
    cari("#dn-judul").scrollIntoView({ block: "center" });
    cari("#dn-judul").focus();
  }

  function simpanDonasi(e) {
    e.preventDefault();
    var tombol = cari("#dn-simpan");
    var m = {
      id: s.ubahDonasi || "",
      judul: cari("#dn-judul").value,
      keterangan: cari("#dn-ket").value,
      bank: cari("#dn-bank").value,
      nomor: cari("#dn-nomor").value,
      atas_nama: cari("#dn-nama").value,
      qris_url: cari("#dn-qris").value.trim(),
      sampai: cari("#dn-sampai").value,
    };
    if (!m.judul.trim()) return aturPesanDi("#pesan-donasi", "Isi judul terlebih dahulu.");
    if (!m.nomor.trim() && !m.qris_url) return aturPesanDi("#pesan-donasi", "Isi nomor rekening atau alamat gambar QRIS.");
    if (m.nomor.trim() && (!m.bank.trim() || !m.atas_nama.trim())) return aturPesanDi("#pesan-donasi", "Nomor rekening harus disertai nama bank dan atas nama.");
    if (m.nomor.trim() && !/^[0-9][0-9 .\-]{2,30}[0-9]$/.test(m.nomor.trim())) return aturPesanDi("#pesan-donasi", "Nomor rekening hanya boleh berisi angka.");
    if (m.qris_url && !/^https:\/\/[^\s"'<>]+$/.test(m.qris_url)) return aturPesanDi("#pesan-donasi", "Alamat gambar QRIS harus diawali https:// dan tanpa spasi.");

    aturPesanDi("#pesan-donasi", "");
    tombol.disabled = true;
    kirim("donasi.simpan", m).then(
      function (r) {
        tombol.disabled = false;
        kosongkanFormDonasi();
        var pesan = r.diganti ? "Saluran infaq diperbarui." : "Saluran infaq tersimpan.";
        aturPesanDi("#pesan-donasi", pesan);
        U.toast(pesan);
        U.segarkanDiam();
        return muatUlangDonasi();
      },
      function (g) {
        tombol.disabled = false;
        if (sesiHabis(g)) return;
        aturPesanDi("#pesan-donasi", pesanGalat(g));
      }
    );
  }

  function muatUlangDonasi() {
    return kirim("donasi.daftar").then(
      function (d) {
        s.donasi = d.donasi || [];
        isiDaftarDonasi();
      },
      function () {}
    );
  }

  function hapusDonasiTerpilih(id) {
    kirim("donasi.hapus", { id: id }).then(
      function () {
        s.hapusDonasi = null;
        if (s.ubahDonasi === id) kosongkanFormDonasi();
        aturPesanDi("#pesan-donasi", "Saluran infaq dihapus.");
        U.toast("Saluran infaq dihapus.");
        U.segarkanDiam();
        return muatUlangDonasi();
      },
      function (g) {
        if (sesiHabis(g)) return;
        s.hapusDonasi = null;
        aturPesanDi("#pesan-donasi", pesanGalat(g));
        isiDaftarDonasi();
      }
    );
  }

  function isiDaftarDonasi() {
    var wadah = cari("#daftar-donasi-admin");
    if (!wadah || s.donasi === null) return;
    var h = U.h;
    if (!s.donasi.length) {
      wadah.replaceChildren(h("p", { class: "catatan", teks: "Belum ada saluran infaq." }));
      return;
    }
    wadah.replaceChildren(
      h(
        "ul",
        { class: "daftar" },
        s.donasi.map(function (d) {
          var menunggu = s.hapusDonasi === d.id;
          var ket = [];
          if (d.nomor) ket.push(d.bank + " " + d.nomor + " a.n. " + d.atas_nama);
          if (d.qris_url) ket.push("QRIS");
          if (d.sampai) ket.push("sampai " + ketTanggal(d.sampai));
          return h(
            "li",
            { class: "baris-daftar tumpuk" },
            h("div", { class: "baris-teks" }, h("p", { class: "kegiatan-nama", teks: d.judul }), h("p", { class: "kegiatan-ket", teks: ket.join(". ") })),
            menunggu
              ? h(
                  "div",
                  { class: "konfirmasi-baris", role: "alertdialog", "aria-label": "Konfirmasi hapus saluran " + d.judul },
                  h("p", { teks: "Hapus saluran infaq ini dari aplikasi?" }),
                  h(
                    "div",
                    { class: "aksi aksi-dua" },
                    h("button", { type: "button", class: "tombol tombol-garis", on: { click: function () { s.hapusDonasi = null; isiDaftarDonasi(); } } }, "Batal"),
                    h("button", { type: "button", class: "tombol tombol-bahaya", on: { click: function () { hapusDonasiTerpilih(d.id); } } }, "Hapus")
                  )
                )
              : h(
                  "div",
                  { class: "aksi-baris" },
                  h("button", { type: "button", class: "tombol tombol-kecil tombol-garis", "aria-label": "Ubah saluran " + d.judul, on: { click: function () { muatDonasiKeForm(d); } } }, "Ubah"),
                  h("button", { type: "button", class: "tombol tombol-kecil tombol-garis", "aria-label": "Hapus saluran " + d.judul, on: { click: function () { s.hapusDonasi = d.id; isiDaftarDonasi(); } } }, "Hapus")
                )
          );
        })
      )
    );
  }

  /* ---------- Banner info penting & ringkasan kajian (admin artikel) ---------- */
  var sedangMemuatArtikel = null;

  function aturPesanDi(id, teks) {
    var el = cari(id);
    if (el) el.textContent = teks || "";
  }

  function muatDataArtikel() {
    if (sedangMemuatArtikel) return sedangMemuatArtikel;
    sedangMemuatArtikel = Promise.all([kirim("banner.daftar"), kirim("kajian.daftar")]).then(
      function (hasil) {
        sedangMemuatArtikel = null;
        s.banner = hasil[0].banner || [];
        s.kajianDaftar = hasil[1].kajian || [];
        isiArtikel();
      },
      function (g) {
        sedangMemuatArtikel = null;
        if (sesiHabis(g)) return;
        var pesan = pesanGalat(g) + " Buka ulang halaman ini untuk memuat daftar lagi.";
        aturPesanDi("#pesan-banner", pesan);
        aturPesanDi("#pesan-kajian", pesan);
        var a = cari("#daftar-banner");
        if (a && s.banner === null) a.textContent = "Daftar belum bisa dimuat.";
        var b = cari("#daftar-kajian-admin");
        if (b && s.kajianDaftar === null) b.textContent = "Daftar belum bisa dimuat.";
      }
    );
    return sedangMemuatArtikel;
  }

  function isiArtikel() {
    bantuJenisBanner();
    isiDaftarBanner();
    isiDaftarKajian();
  }

  function lamaBawaan(jenis) {
    var l = 2;
    JENIS_BANNER.forEach(function (j) {
      if (j.nilai === jenis) l = j.lama;
    });
    return l;
  }

  function panelBanner() {
    var h = U.h;
    var form = h(
      "form",
      { id: "form-banner", novalidate: true, on: { submit: simpanBanner } },
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "b-jenis", teks: "Jenis" }),
        h(
          "select",
          {
            class: "isian",
            id: "b-jenis",
            "aria-describedby": "b-jenis-ket",
            on: {
              change: function () {
                bantuJenisBanner();
                if (cari("#b-sampai").getAttribute("data-manual") !== "1") {
                  cari("#b-sampai").value = tambahHariIso(lamaBawaan(cari("#b-jenis").value));
                }
              },
            },
          },
          JENIS_BANNER.map(function (j) {
            return h("option", { value: j.nilai, teks: j.nama });
          })
        ),
        h("p", { class: "bantu", id: "b-jenis-ket" })
      ),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "b-judul", teks: "Judul" }),
        h("input", { class: "isian", type: "text", id: "b-judul", maxlength: "80", autocomplete: "off" })
      ),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "b-isi", teks: "Isi" }),
        h("textarea", { class: "isian", id: "b-isi", maxlength: "400", "aria-describedby": "b-isi-ket" }),
        h("p", { class: "bantu", id: "b-isi-ket", teks: "Singkat dan jelas, maksimal 400 huruf." })
      ),
      h(
        "div",
        { class: "bidang dua-kolom" },
        h(
          "div",
          null,
          h("label", { for: "b-mulai", teks: "Tayang mulai" }),
          h("input", { class: "isian", type: "date", id: "b-mulai", value: tambahHariIso(0) })
        ),
        h(
          "div",
          null,
          h("label", { for: "b-sampai", teks: "Tayang sampai" }),
          h("input", {
            class: "isian",
            type: "date",
            id: "b-sampai",
            value: tambahHariIso(lamaBawaan("duka")),
            "aria-describedby": "b-sampai-ket",
            on: {
              input: function (e) {
                e.target.setAttribute("data-manual", "1");
              },
            },
          })
        )
      ),
      h("p", { class: "bantu", id: "b-sampai-ket", teks: "Banner hilang sendiri setelah tanggal berakhir. Paling lama 60 hari." }),
      h(
        "div",
        { class: "aksi aksi-dua", id: "b-aksi" },
        h("button", { type: "submit", class: "tombol", id: "b-simpan" }, "Tayangkan banner"),
        h(
          "button",
          { type: "button", class: "tombol tombol-garis", id: "b-batal", hidden: true, on: { click: batalUbahBanner } },
          "Batal ubah"
        )
      )
    );

    return h(
      "section",
      { class: "panel", "aria-labelledby": "bn-judul" },
      h("h2", { class: "panel-judul", id: "bn-judul", teks: "Banner info penting" }),
      h("p", {
        class: "panel-ket",
        teks: "Tampil di paling atas Beranda untuk semua anggota. Untuk kabar yang harus sampai seketika, tetap kabari lewat grup WhatsApp.",
      }),
      form,
      h("p", { id: "pesan-banner", class: "status-pesan", role: "status", "aria-live": "polite" }),
      h("h3", { class: "kelompok-judul", teks: "Banner tersimpan" }),
      h("div", { id: "daftar-banner" }, h("p", { class: "catatan", teks: "Memuat..." }))
    );
  }

  function bantuJenisBanner() {
    var jenis = cari("#b-jenis") ? cari("#b-jenis").value : "duka";
    var teks = "";
    if (jenis === "duka") {
      teks =
        "Kalimat Innalillahi wa inna ilaihi raji'un ditambahkan otomatis. Tulis nama, waktu, dan tempat salat serta pemakaman. Alamat rumah duka hanya bila keluarga setuju, karena halaman ini bisa dibuka siapa saja yang tahu alamatnya.";
    } else if (jenis === "penting") {
      teks = "Untuk perubahan mendadak: acara batal, jadwal atau lokasi pindah.";
    } else {
      teks = "Untuk pemberitahuan lain yang perlu terlihat jelas di Beranda.";
    }
    aturPesanDi("#b-jenis-ket", teks);
  }

  function setelahBannerDisiapkan() {
    bantuJenisBanner();
  }

  function kosongkanFormBanner() {
    s.ubahBanner = null;
    var f = cari("#form-banner");
    if (!f) return;
    cari("#b-jenis").value = "duka";
    cari("#b-judul").value = "";
    cari("#b-isi").value = "";
    cari("#b-mulai").value = tambahHariIso(0);
    cari("#b-sampai").value = tambahHariIso(lamaBawaan("duka"));
    cari("#b-sampai").removeAttribute("data-manual");
    cari("#b-simpan").textContent = "Tayangkan banner";
    cari("#b-batal").hidden = true;
    bantuJenisBanner();
  }

  function batalUbahBanner() {
    kosongkanFormBanner();
    aturPesanDi("#pesan-banner", "");
  }

  function muatBannerKeForm(b) {
    if (!cari("#form-banner")) return;
    s.ubahBanner = b.id;
    cari("#b-jenis").value = b.jenis;
    cari("#b-judul").value = b.judul;
    cari("#b-isi").value = b.isi;
    cari("#b-mulai").value = b.mulai;
    cari("#b-sampai").value = b.sampai;
    cari("#b-sampai").setAttribute("data-manual", "1");
    cari("#b-simpan").textContent = "Simpan perubahan";
    cari("#b-batal").hidden = false;
    bantuJenisBanner();
    aturPesanDi("#pesan-banner", "Banner dimasukkan ke formulir. Ubah lalu simpan.");
    cari("#b-judul").scrollIntoView({ block: "center" });
    cari("#b-judul").focus();
  }

  function simpanBanner(e) {
    e.preventDefault();
    var tombol = cari("#b-simpan");
    var masukan = {
      id: s.ubahBanner || "",
      jenis: cari("#b-jenis").value,
      judul: cari("#b-judul").value,
      isi: cari("#b-isi").value,
      mulai: cari("#b-mulai").value,
      sampai: cari("#b-sampai").value,
    };
    if (!masukan.judul.trim()) return aturPesanDi("#pesan-banner", "Isi judul banner terlebih dahulu.");
    if (!masukan.isi.trim()) return aturPesanDi("#pesan-banner", "Isi keterangan banner terlebih dahulu.");
    if (!masukan.mulai) return aturPesanDi("#pesan-banner", "Isi tanggal mulai tayang.");
    if (!masukan.sampai) return aturPesanDi("#pesan-banner", "Isi tanggal banner berakhir.");
    if (masukan.sampai < masukan.mulai) return aturPesanDi("#pesan-banner", "Tanggal berakhir tidak boleh sebelum tanggal mulai.");
    if (masukan.sampai < tambahHariIso(0)) return aturPesanDi("#pesan-banner", "Tanggal berakhir sudah lewat.");

    aturPesanDi("#pesan-banner", "");
    tombol.disabled = true;
    kirim("banner.simpan", masukan).then(
      function (r) {
        tombol.disabled = false;
        kosongkanFormBanner();
        var pesan = r.diganti ? "Banner diperbarui." : "Banner ditayangkan.";
        aturPesanDi("#pesan-banner", pesan);
        U.toast(pesan);
        U.segarkanDiam();
        return muatUlangBanner();
      },
      function (g) {
        tombol.disabled = false;
        if (sesiHabis(g)) return;
        aturPesanDi("#pesan-banner", pesanGalat(g));
      }
    );
  }

  function muatUlangBanner() {
    return kirim("banner.daftar").then(
      function (d) {
        s.banner = d.banner || [];
        isiDaftarBanner();
      },
      function () {}
    );
  }

  function hapusBannerTerpilih(id) {
    kirim("banner.hapus", { id: id }).then(
      function () {
        s.hapusBanner = null;
        if (s.ubahBanner === id) kosongkanFormBanner();
        aturPesanDi("#pesan-banner", "Banner dihapus.");
        U.toast("Banner dihapus.");
        U.segarkanDiam();
        return muatUlangBanner();
      },
      function (g) {
        if (sesiHabis(g)) return;
        s.hapusBanner = null;
        aturPesanDi("#pesan-banner", pesanGalat(g));
        isiDaftarBanner();
      }
    );
  }

  function ketTanggal(iso) {
    var d = U.bacaTanggal(iso);
    return d ? U.fmtLengkap.format(d) : iso;
  }

  function isiDaftarBanner() {
    var wadah = cari("#daftar-banner");
    if (!wadah || s.banner === null) return;
    var h = U.h;
    setelahBannerDisiapkan();
    if (!s.banner.length) {
      wadah.replaceChildren(h("p", { class: "catatan", teks: "Belum ada banner." }));
      return;
    }
    wadah.replaceChildren(
      h(
        "ul",
        { class: "daftar" },
        s.banner.map(function (b) {
          var menunggu = s.hapusBanner === b.id;
          return h(
            "li",
            { class: "baris-daftar tumpuk" },
            h(
              "div",
              { class: "baris-teks" },
              h(
                "p",
                { class: "kegiatan-nama" },
                b.judul,
                h("span", { class: "status-chip status-chip-" + b.status, teks: NAMA_STATUS[b.status] || b.status })
              ),
              h("p", {
                class: "kegiatan-ket",
                teks: b.jenis.charAt(0).toUpperCase() + b.jenis.slice(1) + ". " + ketTanggal(b.mulai) + " sampai " + ketTanggal(b.sampai) + ".",
              })
            ),
            menunggu
              ? h(
                  "div",
                  { class: "konfirmasi-baris", role: "alertdialog", "aria-label": "Konfirmasi hapus banner " + b.judul },
                  h("p", { teks: "Hapus banner ini dari daftar?" }),
                  h(
                    "div",
                    { class: "aksi aksi-dua" },
                    h(
                      "button",
                      {
                        type: "button",
                        class: "tombol tombol-garis",
                        on: {
                          click: function () {
                            s.hapusBanner = null;
                            isiDaftarBanner();
                          },
                        },
                      },
                      "Batal"
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        class: "tombol tombol-bahaya",
                        on: {
                          click: function () {
                            hapusBannerTerpilih(b.id);
                          },
                        },
                      },
                      "Hapus"
                    )
                  )
                )
              : h(
                  "div",
                  { class: "aksi-baris" },
                  h(
                    "button",
                    {
                      type: "button",
                      class: "tombol tombol-kecil tombol-garis",
                      "aria-label": "Ubah banner " + b.judul,
                      on: {
                        click: function () {
                          muatBannerKeForm(b);
                        },
                      },
                    },
                    "Ubah"
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "tombol tombol-kecil tombol-garis",
                      "aria-label": "Hapus banner " + b.judul,
                      on: {
                        click: function () {
                          s.hapusBanner = b.id;
                          isiDaftarBanner();
                        },
                      },
                    },
                    "Hapus"
                  )
                )
          );
        })
      )
    );
  }

  /* ----- Ringkasan kajian ----- */
  function panelKajian() {
    var h = U.h;
    var form = h(
      "form",
      { id: "form-kajian", novalidate: true, on: { submit: simpanKajian } },
      h(
        "div",
        { class: "bidang dua-kolom" },
        h(
          "div",
          null,
          h("label", { for: "k-jenis", teks: "Jenis" }),
          h(
            "select",
            { class: "isian", id: "k-jenis" },
            h("option", { value: "tausiyah", teks: NAMA_KAJIAN.tausiyah }),
            h("option", { value: "kajian", teks: NAMA_KAJIAN.kajian })
          )
        ),
        h(
          "div",
          null,
          h("label", { for: "k-tanggal", teks: "Tanggal" }),
          h("input", { class: "isian", type: "date", id: "k-tanggal", value: tambahHariIso(0) })
        )
      ),
      h("p", { class: "bantu", id: "k-ket-kunci", teks: "Jenis dan tanggal yang sama menimpa ringkasan sebelumnya." }),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "k-judul", teks: "Judul" }),
        h("input", { class: "isian", type: "text", id: "k-judul", maxlength: "100", autocomplete: "off" })
      ),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "k-penceramah", teks: "Penceramah (opsional)" }),
        h("input", { class: "isian", type: "text", id: "k-penceramah", maxlength: "60", autocomplete: "off" })
      ),
      h(
        "div",
        { class: "bidang" },
        h("label", { for: "k-ringkasan", teks: "Ringkasan" }),
        h("textarea", { class: "isian", id: "k-ringkasan", maxlength: "1200", "aria-describedby": "k-ringkasan-ket" }),
        h("p", {
          class: "bantu",
          id: "k-ringkasan-ket",
          teks: "Di Beranda tampil cuplikan awalnya (sekitar 160 huruf), sisanya dibuka lewat Baca selengkapnya. Maksimal 1200 huruf.",
        })
      ),
      h(
        "div",
        { class: "aksi aksi-dua" },
        h("button", { type: "submit", class: "tombol", id: "k-simpan" }, "Simpan ringkasan"),
        h(
          "button",
          { type: "button", class: "tombol tombol-garis", id: "k-batal", hidden: true, on: { click: batalUbahKajian } },
          "Batal ubah"
        )
      )
    );

    return h(
      "section",
      { class: "panel", "aria-labelledby": "kj-judul" },
      h("h2", { class: "panel-judul", id: "kj-judul", teks: "Ringkasan kajian" }),
      h("p", {
        class: "panel-ket",
        teks: "Ringkasan tausiyah malam Jumat dan kajian Ahad pagi. Beranda menampilkan yang terbaru dari tiap jenis.",
      }),
      form,
      h("p", { id: "pesan-kajian", class: "status-pesan", role: "status", "aria-live": "polite" }),
      h("h3", { class: "kelompok-judul", teks: "Ringkasan tersimpan" }),
      h("div", { id: "daftar-kajian-admin" }, h("p", { class: "catatan", teks: "Memuat..." }))
    );
  }

  function kosongkanFormKajian() {
    s.ubahKajian = null;
    if (!cari("#form-kajian")) return;
    cari("#k-jenis").disabled = false;
    cari("#k-tanggal").disabled = false;
    cari("#k-jenis").value = "tausiyah";
    cari("#k-tanggal").value = tambahHariIso(0);
    cari("#k-judul").value = "";
    cari("#k-penceramah").value = "";
    cari("#k-ringkasan").value = "";
    cari("#k-simpan").textContent = "Simpan ringkasan";
    cari("#k-batal").hidden = true;
    cari("#k-ket-kunci").textContent = "Jenis dan tanggal yang sama menimpa ringkasan sebelumnya.";
  }

  function batalUbahKajian() {
    kosongkanFormKajian();
    aturPesanDi("#pesan-kajian", "");
  }

  function muatKajianKeForm(k) {
    if (!cari("#form-kajian")) return;
    s.ubahKajian = { jenis: k.jenis, tanggal: k.tanggal };
    cari("#k-jenis").value = k.jenis;
    cari("#k-tanggal").value = k.tanggal;
    cari("#k-jenis").disabled = true;
    cari("#k-tanggal").disabled = true;
    cari("#k-judul").value = k.judul;
    cari("#k-penceramah").value = k.penceramah;
    cari("#k-ringkasan").value = k.ringkasan;
    cari("#k-simpan").textContent = "Simpan perubahan";
    cari("#k-batal").hidden = false;
    cari("#k-ket-kunci").textContent = "Jenis dan tanggal tidak bisa diubah. Untuk memindahkan, hapus lalu buat baru.";
    aturPesanDi("#pesan-kajian", "Ringkasan dimasukkan ke formulir. Ubah lalu simpan.");
    cari("#k-judul").scrollIntoView({ block: "center" });
    cari("#k-judul").focus();
  }

  function simpanKajian(e) {
    e.preventDefault();
    var tombol = cari("#k-simpan");
    var kunci = s.ubahKajian;
    var masukan = {
      jenis: kunci ? kunci.jenis : cari("#k-jenis").value,
      tanggal: kunci ? kunci.tanggal : cari("#k-tanggal").value,
      judul: cari("#k-judul").value,
      penceramah: cari("#k-penceramah").value,
      ringkasan: cari("#k-ringkasan").value,
    };
    if (!masukan.tanggal) return aturPesanDi("#pesan-kajian", "Isi tanggal kajian.");
    if (!masukan.judul.trim()) return aturPesanDi("#pesan-kajian", "Isi judul terlebih dahulu.");
    if (!masukan.ringkasan.trim()) return aturPesanDi("#pesan-kajian", "Isi ringkasan terlebih dahulu.");

    aturPesanDi("#pesan-kajian", "");
    tombol.disabled = true;
    kirim("kajian.simpan", masukan).then(
      function (r) {
        tombol.disabled = false;
        kosongkanFormKajian();
        var pesan = r.diganti ? "Ringkasan diperbarui." : "Ringkasan tersimpan.";
        aturPesanDi("#pesan-kajian", pesan);
        U.toast(pesan);
        U.segarkanDiam();
        return muatUlangKajian();
      },
      function (g) {
        tombol.disabled = false;
        if (sesiHabis(g)) return;
        aturPesanDi("#pesan-kajian", pesanGalat(g));
      }
    );
  }

  function muatUlangKajian() {
    return kirim("kajian.daftar").then(
      function (d) {
        s.kajianDaftar = d.kajian || [];
        isiDaftarKajian();
      },
      function () {}
    );
  }

  function hapusKajianTerpilih(k) {
    kirim("kajian.hapus", { jenis: k.jenis, tanggal: k.tanggal }).then(
      function () {
        s.hapusKajian = null;
        if (s.ubahKajian && s.ubahKajian.jenis === k.jenis && s.ubahKajian.tanggal === k.tanggal) kosongkanFormKajian();
        aturPesanDi("#pesan-kajian", "Ringkasan dihapus.");
        U.toast("Ringkasan dihapus.");
        U.segarkanDiam();
        return muatUlangKajian();
      },
      function (g) {
        if (sesiHabis(g)) return;
        s.hapusKajian = null;
        aturPesanDi("#pesan-kajian", pesanGalat(g));
        isiDaftarKajian();
      }
    );
  }

  function isiDaftarKajian() {
    var wadah = cari("#daftar-kajian-admin");
    if (!wadah || s.kajianDaftar === null) return;
    var h = U.h;
    if (!s.kajianDaftar.length) {
      wadah.replaceChildren(h("p", { class: "catatan", teks: "Belum ada ringkasan." }));
      return;
    }
    wadah.replaceChildren(
      h(
        "ul",
        { class: "daftar" },
        s.kajianDaftar.map(function (k) {
          var kunci = k.jenis + "|" + k.tanggal;
          var menunggu = s.hapusKajian === kunci;
          return h(
            "li",
            { class: "baris-daftar tumpuk" },
            h(
              "div",
              { class: "baris-teks" },
              h("p", { class: "kegiatan-nama", teks: k.judul }),
              h("p", {
                class: "kegiatan-ket",
                teks: (NAMA_KAJIAN[k.jenis] || k.jenis) + ". " + ketTanggal(k.tanggal) + (k.penceramah ? ". " + k.penceramah : "") + ".",
              })
            ),
            menunggu
              ? h(
                  "div",
                  { class: "konfirmasi-baris", role: "alertdialog", "aria-label": "Konfirmasi hapus ringkasan " + k.judul },
                  h("p", { teks: "Hapus ringkasan ini?" }),
                  h(
                    "div",
                    { class: "aksi aksi-dua" },
                    h(
                      "button",
                      {
                        type: "button",
                        class: "tombol tombol-garis",
                        on: {
                          click: function () {
                            s.hapusKajian = null;
                            isiDaftarKajian();
                          },
                        },
                      },
                      "Batal"
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        class: "tombol tombol-bahaya",
                        on: {
                          click: function () {
                            hapusKajianTerpilih(k);
                          },
                        },
                      },
                      "Hapus"
                    )
                  )
                )
              : h(
                  "div",
                  { class: "aksi-baris" },
                  h(
                    "button",
                    {
                      type: "button",
                      class: "tombol tombol-kecil tombol-garis",
                      "aria-label": "Ubah ringkasan " + k.judul,
                      on: {
                        click: function () {
                          muatKajianKeForm(k);
                        },
                      },
                    },
                    "Ubah"
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "tombol tombol-kecil tombol-garis",
                      "aria-label": "Hapus ringkasan " + k.judul,
                      on: {
                        click: function () {
                          s.hapusKajian = kunci;
                          isiDaftarKajian();
                        },
                      },
                    },
                    "Hapus"
                  )
                )
          );
        })
      )
    );
  }

  /* ---------- Pintu masuk dari app.js ---------- */
  function buatLayar(alat) {
    U = alat;
    akar = document.createElement("div");
    gambar();
    return akar;
  }

  return { buatLayar: buatLayar };
})();
