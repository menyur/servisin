// ============================================================================
// scripts/lib/fake-supabase.mjs — klien Supabase TIRUAN (in-memory).
//
// Kenapa ada: probe live (scripts/verify-account-deletion.mjs) butuh database
// sungguhan, sehingga jalur web tidak bisa diuji sebelum migrasi dijalankan.
// Tiruan ini meniru bagian kecil PostgREST yang benar-benar dipakai
// src/lib/account-deletion.js — cukup untuk membuktikan aturan yang murni logika:
// token disimpan sebagai hash, sekali pakai, kedaluwarsa, jeda per alamat, dan
// jawaban anti-enumerasi. Ia TIDAK membuktikan SQL-nya benar; itu tugas probe live.
//
// Sengaja kecil dan jujur: hanya operator yang dipakai nyata (select/insert/
// update/delete + eq/ilike/in/order/limit + maybeSingle/single). Kalau kode
// memakai operator lain, tiruan ini akan gagal keras — itu disengaja, supaya ia
// tidak diam-diam "setuju" atas hal yang tidak dimengerti.
// ============================================================================

/**
 * @param {object} o
 * @param {object|null} [o.profil]     hasil pencarian profil (profiles.maybeSingle)
 * @param {string|null} [o.blokir]     jawaban RPC hapus_akun_blokir
 * @param {Array<object>} [o.rows]     isi tabel account_deletion_requests
 */
export function fakeAdmin({ profil = null, blokir = null, rows = [] } = {}) {
  const state = { rows: [...rows], seq: 0, log: [], blokir, dihapus: [] };

  const cocok = (baris, filter) =>
    Object.entries(filter).every(([k, v]) => {
      if (k === "status__in") return Array.isArray(v) ? v.includes(baris.status) : baris.status === v;
      if (k === "email__ilike") return String(baris.email).toLowerCase() === String(v).toLowerCase();
      return baris[k] === v;
    });

  const jalankan = (q) => {
    state.log.push(`${q.op} ${q.table}`);
    if (q.table === "profiles") {
      return { data: profil, error: null };
    }
    if (q.table !== "account_deletion_requests") {
      throw new Error(`fake-supabase: tabel "${q.table}" tidak dikenal`);
    }

    if (q.op === "insert") {
      const baris = {
        id: `req-${++state.seq}`,
        user_id: null,
        alasan: null,
        kode_hash: null,
        kode_expires_at: null,
        confirmed_at: null,
        ...q.payload,
      };
      state.rows.push(baris);
      return { data: baris, error: null };
    }
    if (q.op === "update") {
      const kena = state.rows.filter((b) => cocok(b, q.filter));
      for (const b of kena) Object.assign(b, q.payload);
      return { data: kena, error: null };
    }
    if (q.op === "delete") {
      const kena = state.rows.filter((b) => cocok(b, q.filter));
      state.rows = state.rows.filter((b) => !cocok(b, q.filter));
      state.dihapus.push(...kena);
      return { data: kena, error: null };
    }
    // select
    const kena = state.rows.filter((b) => cocok(b, q.filter));
    return { data: kena[0] ?? null, error: null };
  };

  const rantai = (table) => {
    const q = { table, op: "select", filter: {}, payload: null };

    const api = {
      // `.select()` boleh muncul SESUDAH `.insert()`/`.update()` (PostgREST:
      // minta baris hasilnya) tanpa mengubah operasinya — jadi op bawaan
      // "select" TIDAK ditulis ulang di sini.
      select: () => api,
      insert: (payload) => {
        q.op = "insert";
        q.payload = payload;
        return api;
      },
      update: (payload) => {
        q.op = "update";
        q.payload = payload;
        return api;
      },
      delete: () => {
        q.op = "delete";
        return api;
      },
      eq: (kolom, nilai) => {
        q.filter[kolom] = nilai;
        return api;
      },
      ilike: (kolom, nilai) => {
        q.filter[`${kolom}__ilike`] = nilai;
        return api;
      },
      in: (kolom, nilai) => {
        q.filter[`${kolom}__in`] = nilai;
        return api;
      },
      order: () => api,
      limit: () => api,
      maybeSingle: async () => jalankan(q),
      single: async () => {
        const hasil = jalankan(q);
        return { data: Array.isArray(hasil.data) ? hasil.data[0] : hasil.data, error: hasil.error };
      },
      // PostgREST mengembalikan "thenable": `await dari('x').delete().eq(...)`
      // bekerja tanpa terminal call. Tiruan harus bisa itu juga.
      then: (resolve, reject) => Promise.resolve(jalankan(q)).then(resolve, reject),
    };
    return api;
  };

  return {
    state,
    from: rantai,
    rpc: async (nama) => {
      state.log.push(`rpc ${nama}`);
      if (nama === "hapus_akun_blokir") return { data: state.blokir, error: null };
      throw new Error(`fake-supabase: RPC "${nama}" tidak dikenal`);
    },
  };
}
