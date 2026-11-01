"use client";

import { useMemo, useState } from "react";
import { Mail, MapPin, Pencil, Phone, ReceiptText, UserRound, X, Wallet } from "lucide-react";

import { formatRupiah } from "@/lib/pricing";
import { updateCustomerProfileAdmin } from "@/app/actions/admin";
import { StatusPill } from "@/components/StatusPipeline";

/**
 * Tab "Pelanggan" di panel admin: profil pelanggan dalam satu tempat.
 *
 * Kenapa perlu tab sendiri: data pelanggan (nama, email, telepon, alamat) sudah
 * ada di tab "Pengguna & Teknisi", tetapi di sana bercampur dengan akun teknisi
 * dan admin — dan yang ditampilkan hanya nama + email + telepon. Admin yang
 * menjawab telepon "pesanan saya belum datang" tidak bisa melihat ALAMAT
 * pelanggan, berapa pesanan yang pernah ia buat, atau total belanjanya tanpa
 * mencari manual di tab Pesanan.
 *
 * Sumber data sengaja hanya yang sudah dimuat panel (profiles + bookings),
 * tanpa query tambahan: profil pelanggan adalah turunan dari dua tabel itu.
 *
 * KECUALI penyuntingan: nama/telepon/alamat bisa diubah dari sini lewat
 * `updateCustomerProfileAdmin`. Sebelumnya tab ini baca-saja, sehingga admin
 * yang menerima telepon "alamat saya salah" tidak punya cara memperbaikinya —
 * padahal alamat itulah yang dipakai wizard (isi otomatis) dan rute teknisi.
 */
export default function CustomerProfilesTab({ users = [], bookings = [], onUpdate }) {
  const [cari, setCari] = useState("");
  const [pilih, setPilih] = useState(null);
  // Mode sunting: hanya satu pelanggan pada satu waktu.
  const [mengubah, setMengubah] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState(null);

  function mulaiUbah(u) {
    setForm({ name: u.name || "", phone: u.phone || "", address: u.address || "" });
    setGalat(null);
    setMengubah(true);
  }

  async function simpanPerubahan() {
    if (sibuk || !pilih) return;
    setSibuk(true);
    setGalat(null);
    const res = await updateCustomerProfileAdmin(pilih.id, form);
    setSibuk(false);
    if (res?.error) {
      setGalat(res.error);
      return;
    }
    const baru = res.profile || form;
    // Panel memakai state `users` milik dashboard: tanpa ini, kartu di belakang
    // modal tetap menampilkan alamat lama sampai halaman dimuat ulang.
    onUpdate?.(pilih.id, baru);
    setPilih((p) => (p ? { ...p, ...baru } : p));
    setMengubah(false);
  }

  // Satu baris profil + ringkasan pesanannya. Dihitung sekali per perubahan
  // data, bukan per render, supaya mengetik di kotak cari tetap ringan walau
  // pelanggannya ribuan.
  const pelanggan = useMemo(() => {
    const perPelanggan = new Map();
    for (const b of bookings) {
      const id = b.user_id;
      if (!id) continue;
      const r = perPelanggan.get(id) || {
        jumlah: 0,
        total: 0,
        terakhir: null,
        pesanan: [],
      };
      r.jumlah += 1;
      // Hanya uang yang benar-benar masuk hitungan: pesanan yang dibatalkan
      // tidak boleh menggelembungkan "total belanja" pelanggan.
      if (b.status !== "cancelled") r.total += Number(b.total_price) || 0;
      const waktu = b.created_at || b.booking_date || "";
      if (!r.terakhir || String(waktu) > String(r.terakhir)) r.terakhir = waktu;
      r.pesanan.push(b);
      perPelanggan.set(id, r);
    }

    return users
      .filter((u) => u.role === "customer")
      .map((u) => {
        const r = perPelanggan.get(u.id);
        return {
          ...u,
          jumlahPesanan: r?.jumlah || 0,
          totalBelanja: r?.total || 0,
          pesananTerakhir: r?.terakhir || null,
          pesanan: (r?.pesanan || [])
            .slice()
            .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))),
        };
      })
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [users, bookings]);

  const kata = cari.trim().toLowerCase();
  const tampil = kata
    ? pelanggan.filter((u) =>
        [u.name, u.email, u.phone, u.address]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(kata))
      )
    : pelanggan;

  const denganPesanan = pelanggan.filter((u) => u.jumlahPesanan > 0).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari nama, email, telepon, atau alamat pelanggan…"
          className="input !py-2 text-sm flex-1 min-w-[220px]"
        />
        <span className="pill bg-brand-tint text-brand-deep text-[11px] font-semibold">
          {pelanggan.length} pelanggan
        </span>
        <span className="pill bg-mint-tint text-mint text-[11px] font-semibold">
          {denganPesanan} pernah memesan
        </span>
      </div>

      {tampil.length === 0 && (
        <p className="text-ink-soft text-sm">
          {kata
            ? "Tidak ada pelanggan yang cocok dengan pencarian itu."
            : "Belum ada pelanggan terdaftar."}
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {tampil.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => setPilih(u)}
            className="card text-left hover:border-brand/40 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-full bg-brand-tint text-brand-deep grid place-items-center shrink-0">
                <UserRound size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-navy text-sm truncate">{u.name || "(tanpa nama)"}</p>
                <p className="text-xs text-ink-soft truncate">{u.email}</p>
                <p className="text-xs text-ink-soft truncate">{u.phone || "telepon belum diisi"}</p>
                <p className="text-xs text-ink-soft truncate flex items-center gap-1 mt-1">
                  <MapPin size={11} /> {u.address || "alamat belum diisi"}
                </p>
                <p className="text-[11px] text-ink-soft mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="pill bg-paper border border-line text-[10px]">
                    {u.jumlahPesanan} pesanan
                  </span>
                  <span className="pill bg-paper border border-line text-[10px]">
                    {formatRupiah(u.totalBelanja)}
                  </span>
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {pilih && (
        <div className="fixed inset-0 z-50 bg-navy/40 grid place-items-center p-4" onClick={() => setPilih(null)}>
          <div
            className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display font-bold text-navy text-lg">{pilih.name || "(tanpa nama)"}</p>
                <p className="text-xs text-ink-soft">
                  Pelanggan sejak{" "}
                  {pilih.created_at
                    ? new Date(pilih.created_at).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : "tanggal tidak tercatat"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {!mengubah && (
                  <button
                    type="button"
                    onClick={() => mulaiUbah(pilih)}
                    className="flex items-center gap-1 text-xs font-semibold text-brand-deep hover:text-brand px-2 py-1 rounded-lg hover:bg-brand-tint"
                  >
                    <Pencil size={13} /> Ubah
                  </button>
                )}
                <button type="button" onClick={() => { setMengubah(false); setPilih(null); }} className="text-ink-soft hover:text-navy">
                  <X size={18} />
                </button>
              </div>
            </div>

            {mengubah ? (
              <div className="space-y-2.5">
                <div>
                  <label className="text-[11px] font-semibold text-ink-soft" htmlFor="cust-nama">
                    Nama lengkap
                  </label>
                  <input
                    id="cust-nama"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    maxLength={80}
                    className="input !py-2 text-sm w-full"
                    placeholder="Nama pelanggan"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-ink-soft" htmlFor="cust-hp">
                    Nomor HP
                  </label>
                  <input
                    id="cust-hp"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    maxLength={20}
                    inputMode="tel"
                    className="input !py-2 text-sm w-full"
                    placeholder="0812-3456-7890"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-ink-soft" htmlFor="cust-alamat">
                    Alamat (dipakai untuk pesanan & rute teknisi)
                  </label>
                  <textarea
                    id="cust-alamat"
                    value={form.address}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    maxLength={300}
                    rows={3}
                    className="input !py-2 text-sm w-full"
                    placeholder="Nama jalan, nomor rumah, kelurahan, kota"
                  />
                  <p className="text-[11px] text-ink-soft mt-1">
                    {form.address.length}/300 karakter
                  </p>
                </div>
                {galat && <p className="text-xs text-coral font-semibold">{galat}</p>}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={simpanPerubahan}
                    disabled={sibuk}
                    className="btn-primary !py-2 text-sm"
                  >
                    {sibuk ? "Menyimpan…" : "Simpan perubahan"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMengubah(false); setGalat(null); }}
                    disabled={sibuk}
                    className="text-sm font-semibold text-ink-soft hover:text-navy px-3 py-2"
                  >
                    Batal
                  </button>
                </div>
                <p className="text-[11px] text-ink-soft">
                  Perubahan alamat di sini tidak mengubah pesanan yang sudah dibuat — hanya
                  mengisi otomatis pesanan berikutnya.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 text-sm">
                <p className="flex items-center gap-2 text-navy">
                  <Mail size={14} className="text-ink-soft" /> {pilih.email || "-"}
                </p>
                <p className="flex items-center gap-2 text-navy">
                  <Phone size={14} className="text-ink-soft" /> {pilih.phone || "belum diisi"}
                </p>
                <p className="flex items-start gap-2 text-navy">
                  <MapPin size={14} className="text-ink-soft mt-0.5" />
                  <span>{pilih.address || "belum diisi"}</span>
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-line p-3">
                <p className="text-[11px] text-ink-soft flex items-center gap-1">
                  <ReceiptText size={11} /> Total pesanan
                </p>
                <p className="font-bold text-navy text-sm">{pilih.jumlahPesanan}</p>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[11px] text-ink-soft flex items-center gap-1">
                  <Wallet size={11} /> Total belanja
                </p>
                <p className="font-bold text-navy text-sm">{formatRupiah(pilih.totalBelanja)}</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-navy mb-1.5">Pesanan terakhir</p>
              {pilih.pesanan.length === 0 && (
                <p className="text-xs text-ink-soft">Belum ada pesanan.</p>
              )}
              <div className="space-y-1.5">
                {pilih.pesanan.slice(0, 6).map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-navy truncate">#{b.code}</p>
                      <p className="text-[11px] text-ink-soft">
                        {b.booking_date || "-"} · {b.booking_time || "-"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-ink-soft">{formatRupiah(Number(b.total_price) || 0)}</span>
                      <StatusPill status={b.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
