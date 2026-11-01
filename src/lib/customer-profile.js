/**
 * Validasi data kontak PELANGGAN yang diubah admin dari tab "Pelanggan".
 *
 * Dipisah dari server action-nya supaya bisa diuji tanpa sesi admin/jaringan
 * (scripts/verify-admin-audit.mjs). Aturan yang dijaga:
 *
 *   - nama wajib dan tidak kepanjangan — nama dipakai di struk, email, dan
 *     sapaan aplikasi, jadi kosong berarti pesanan tanpa identitas;
 *   - nomor HP/alamat boleh kosong (pelanggan boleh belum mengisinya), tetapi
 *     kalau diisi harus masuk akal: nomor HP Indonesia sering ditulis
 *     "0812-3456-7890" atau "+62 812 3456 7890", jadi yang ditolak hanya
 *     karakter yang jelas bukan nomor;
 *   - alamat dibatasi 300 karakter — batas yang sama dengan RPC buku alamat
 *     (supabase/migrate-customer-address-book.sql), agar alamat yang diisi
 *     admin selalu bisa dipakai fitur itu;
 *   - string kosong disimpan sebagai NULL, bukan "", supaya pemeriksaan
 *     "belum diisi" di aplikasi dan panel tetap konsisten.
 */

const POLA_HP = /^[+()\-\s0-9]{6,20}$/;

/** Ambil & rapikan tiga bidang kontak (selalu mengembalikan string). */
export function normalisasiProfilPelanggan({ name, phone, address } = {}) {
  return {
    name: String(name ?? "").trim(),
    phone: String(phone ?? "").trim(),
    address: String(address ?? "").trim(),
  };
}

/**
 * @returns {{ok: true, nilai: {name: string, phone: string|null, address: string|null}}
 *          | {ok: false, error: string}}
 */
export function validasiProfilPelanggan(input = {}) {
  const { name, phone, address } = normalisasiProfilPelanggan(input);

  if (!name) return { ok: false, error: "Nama pelanggan wajib diisi." };
  if (name.length > 80) return { ok: false, error: "Nama maksimal 80 karakter." };
  if (phone && !POLA_HP.test(phone)) {
    return { ok: false, error: "Nomor HP tidak valid (contoh: 0812-3456-7890)." };
  }
  if (address.length > 300) return { ok: false, error: "Alamat maksimal 300 karakter." };

  return { ok: true, nilai: { name, phone: phone || null, address: address || null } };
}
