/**
 * JEJAK AUDIT TINDAKAN ADMIN — satu pintu penulisan.
 *
 * Tabel `admin_audit_log` (supabase/migrate-admin-audit-log.sql) bersifat
 * tambah-saja: tidak ada policy UPDATE/DELETE. Nilai `before`/`after` disimpan
 * sebagai jsonb berisi kolom yang relevan saja, bukan salinan seluruh baris —
 * dokumen pribadi (KTP, alamat, nomor telepon) tidak ikut tercatat tanpa perlu.
 *
 * Penulisan audit TIDAK PERNAH boleh menggagalkan aksi utama: kalau tabelnya
 * belum dimigrasikan atau insert ditolak, aksi tetap berhasil dan kegagalan
 * hanya muncul di log server. Jejak yang hilang lebih baik daripada admin yang
 * tidak bisa mengubah harga karena tabel audit bermasalah.
 */

/** Label manusiawi untuk filter di panel. */
export const AUDIT_ENTITY_LABEL = {
  service: "Layanan",
  category: "Kategori",
  profile: "Pengguna",
  voucher: "Voucher",
  settings: "Setelan",
  booking: "Pesanan",
  refund: "Pengembalian dana",
  technician_leave: "Cuti teknisi",
  account: "Hapus akun",
};

/** Kolom yang tidak boleh masuk jejak (dokumen/identitas pribadi). */
const KOLOM_SENSITIF = new Set([
  "ktp_url",
  "password",
  "email",
  "phone",
  "address",
  "bank_number",
  "account_number",
  "transfer_account_number",
]);

/** Ambil hanya kolom yang nilainya berubah; nilai sensitif disamarkan. */
export function bedaKolom(before = {}, after = {}, { maks = 12 } = {}) {
  const b = {};
  const a = {};
  const semua = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of semua) {
    // Bandingkan NILAI MASUKAN. Membandingkan objek hasil (b/a) selalu sama
    // (undefined) sehingga seluruh diff diam-diam kosong.
    if (before?.[k] === after?.[k]) continue;
    if (KOLOM_SENSITIF.has(k)) {
      b[k] = before?.[k] == null ? null : "(disembunyikan)";
      a[k] = after?.[k] == null ? null : "(disembunyikan)";
    } else {
      b[k] = before?.[k] ?? null;
      a[k] = after?.[k] ?? null;
    }
    if (Object.keys(a).length >= maks) break;
  }
  return { before: Object.keys(b).length ? b : null, after: Object.keys(a).length ? a : null };
}

/**
 * Tulis satu baris jejak audit.
 *
 * @param supabase klien sesi admin (RLS insert admin) — bukan service role,
 *                 supaya `admin_id`/`admin_name` berasal dari sesi yang benar.
 * @param admin    objek user Supabase hasil requireAdmin (punya id & email).
 * @returns id baris, atau null bila gagal (tidak pernah melempar).
 */
export async function catatAuditAdmin(
  supabase,
  admin,
  { action, entity, entityId = null, summary, before = null, after = null } = {}
) {
  try {
    if (!admin?.id) return null;
    if (!action || !entity || !summary) {
      console.error("[audit] entri tidak lengkap:", { action, entity, summary });
      return null;
    }
    const { data, error } = await supabase
      .from("admin_audit_log")
      .insert({
        admin_id: admin.id,
        admin_name: admin.user_metadata?.name || admin.email || null,
        action,
        entity,
        entity_id: entityId == null ? null : String(entityId),
        summary,
        before,
        after,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[audit] gagal menulis jejak:", error.message);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.error("[audit] gagal menulis jejak:", e?.message || e);
    return null;
  }
}
