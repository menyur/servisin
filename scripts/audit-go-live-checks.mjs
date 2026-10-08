// ============================================================================
// audit-go-live-checks.mjs — probe LIVE untuk item F3, F4, F5, F6 di
// docs/go-live-audit.md. Semua pemeriksaan memakai data uji yang
// DIBERSIHKAN SENDIRI (baris + akun sementara), jadi aman diulang.
//
//   F3 — Apakah "Allow anonymous sign-ins" masih aktif?
//        → coba signInAnonymously dengan kunci anon. Bila berhasil, sesi anon
//          langsung dihapus lagi dan status dilaporkan masih TERBUKA.
//   F4 — Apakah claim_job menolak pekerjaan di luar keahlian (skill)?
//        → teknisi uji ber-skill 'ac' mencoba klaim pekerjaan kategori LAIN
//          (harus ditolak) lalu pekerjaan kategori 'ac' (harus diterima).
//   F5 — Apakah pelanggan bisa menilai pesanan yang BELUM selesai?
//        → pelanggan uji memasukkan review untuk pesanan berstatus 'pending'
//          (seharusnya ditolak setelah policy diperketat).
//   F6 — Apakah CHECK payment_method sudah bersih ('cod','transfer')?
//        → INSERT dengan 'qris' harus GAGAL, dengan 'transfer'/'cod' harus
//          BERHASIL (kalau 'transfer' ditolak = bug nyata: app memakai nilai itu).
//
// Exit code: 0 = semua TERTUTUP, 5 = ada temuan masih TERBUKA, 1 = error.
// Tidak pernah mencetak nilai rahasia.
// ============================================================================
import {
  loadEnv,
  makeAdminClient,
  makeAnonClient,
  makeUserClient,
  createTempUser,
  deleteTempUsers,
  sleep,
} from "./lib/probe-env.mjs";

const stamp = Date.now();
const open = [];
const closed = [];

function report(id, title, status, detail) {
  const icon =
    status === "TERTUTUP" ? "✅" : status === "TERBUKA" ? "🔴" : status === "REGRESI" ? "🔴" : "ℹ️";
  console.log(`${icon} ${id} ${title}: ${status}`);
  console.log(`   ${detail}`);
  if (status === "TERBUKA" || status === "REGRESI") open.push(`${id}${status === "REGRESI" ? "(REGRESI)" : ""}`);
  if (status === "TERTUTUP") closed.push(id);
}

function probeBooking(fixtures, code, extra = {}) {
  return {
    code,
    user_id: fixtures.profileId,
    service_id: fixtures.serviceId,
    booking_date: new Date().toISOString().slice(0, 10),
    booking_time: "00:00-00:00",
    address: "AUDIT GO-LIVE — baris uji otomatis, aman dihapus",
    notes: "probe scripts/audit-go-live-checks.mjs",
    subtotal_price: 1,
    total_price: 1,
    status: "pending",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// F3 — anonymous sign-ins
// ---------------------------------------------------------------------------
async function checkF3(env, admin) {
  const anon = makeAnonClient(env);
  const { data, error } = await anon.auth.signInAnonymously();
  if (error) {
    report(
      "F3",
      "Anonymous sign-in",
      "TERTUTUP",
      `Supabase menolak signInAnonymously → ${error.message}`
    );
    return;
  }
  // Berhasil → masih aktif. Bersihkan sesi/user anon agar tidak menumpuk.
  const userId = data?.user?.id ?? null;
  await anon.auth.signOut();
  let cleaned = "tidak ada user untuk dihapus";
  if (userId) {
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    cleaned = delErr ? `GAGAL hapus user anon (${delErr.message})` : "user anon uji dihapus";
  }
  report(
    "F3",
    "Anonymous sign-in",
    "TERBUKA",
    `signInAnonymously BERHASIL → fitur masih aktif di Authentication → Providers. ${cleaned}. Matikan manual di dashboard Supabase.`
  );
}

// ---------------------------------------------------------------------------
// F6 — CHECK constraint payment_method
// ---------------------------------------------------------------------------
async function checkF6(admin, fixtures) {
  const inserted = [];
  const tryInsert = async (method) => {
    const { data, error } = await admin
      .from("bookings")
      .insert(probeBooking(fixtures, `AUDIT-F6-${method}-${stamp}`, { payment_method: method }))
      .select("id")
      .single();
    if (!error) inserted.push(data.id);
    return { ok: !error, error: error?.message ?? null };
  };

  const legacy = await tryInsert("qris");
  const transfer = await tryInsert("transfer");
  const cod = await tryInsert("cod");

  for (const id of inserted) await admin.from("bookings").delete().eq("id", id);

  const legacyRejected = !legacy.ok;
  const uiValuesOk = transfer.ok && cod.ok;

  if (legacyRejected && uiValuesOk) {
    report(
      "F6",
      "CHECK payment_method",
      "TERTUTUP",
      "Nilai lama 'qris' DITOLAK constraint, sedangkan 'transfer' & 'cod' diterima → migrate-transfer-settings.sql sudah jalan."
    );
  } else if (!uiValuesOk) {
    report(
      "F6",
      "CHECK payment_method",
      "TERBUKA",
      `BUG: nilai yang dipakai UI ditolak DB — transfer=${transfer.ok ? "OK" : transfer.error}, cod=${cod.ok ? "OK" : cod.error}. Jalankan migrate-transfer-settings.sql.`
    );
  } else {
    report(
      "F6",
      "CHECK payment_method",
      "TERBUKA",
      "Constraint masih menerima nilai lama 'qris' — jalankan supabase/migrate-transfer-settings.sql."
    );
  }
}

// ---------------------------------------------------------------------------
// F4 & F5 butuh akun uji bertipe peran berbeda
// ---------------------------------------------------------------------------
async function checkF4F5(admin, env, fixtures) {
  const tempUsers = [];
  const probeIds = [];
  const reviewIds = [];
  try {
    const customer = await createTempUser(admin, "customer", "audit-cust");
    const technician = await createTempUser(admin, "technician", "audit-tech");
    tempUsers.push(customer, technician);

    // Ambil dua kategori layanan yang berbeda untuk uji keahlian.
    const { data: services, error: svcErr } = await admin
      .from("services")
      .select("id,category_id")
      .not("category_id", "is", null)
      .limit(50);
    if (svcErr) throw new Error(`gagal baca services: ${svcErr.message}`);
    const { data: categories } = await admin.from("categories").select("id,name");
    const catName = (id) => categories?.find((c) => c.id === id)?.name ?? id ?? "?";
    const serviceA = services?.[0] ?? null;
    const serviceB = services?.find((s) => s.category_id !== serviceA?.category_id) ?? null;
    if (!serviceA || !serviceB) {
      report("F4", "claim_job guard keahlian", "TIDAK_DIUJI", "butuh 2 layanan dengan kategori berbeda di katalog.");
      return { customer, technician };
    }

    // Teknisi uji: skill = kategori serviceA, approved (syarat is_active_technician).
    const { error: updErr } = await admin
      .from("profiles")
      .update({ skill: serviceA.category_id, approval_status: "approved" })
      .eq("id", technician.id);
    if (updErr) throw new Error(`gagal menyiapkan teknisi uji: ${updErr.message}`);

    // Dua pekerjaan: satu BEDA kategori (harus ditolak), satu SAMA kategori (harus diterima).
    const mismatch = await admin
      .from("bookings")
      .insert(
        probeBooking({ profileId: customer.id, serviceId: serviceB.id }, `AUDIT-F4-MISMATCH-${stamp}`, {
          status: "paid",
        })
      )
      .select("id")
      .single();
    const match = await admin
      .from("bookings")
      .insert(
        probeBooking({ profileId: customer.id, serviceId: serviceA.id }, `AUDIT-F4-MATCH-${stamp}`, {
          status: "paid",
        })
      )
      .select("id")
      .single();
    if (mismatch.error || match.error) throw new Error(`gagal membuat pekerjaan uji: ${mismatch.error?.message || match.error?.message}`);
    probeIds.push(mismatch.data.id, match.data.id);

    const techClient = makeUserClient(env);
    const { error: signErr } = await techClient.auth.signInWithPassword({ email: technician.email, password: technician.password });
    if (signErr) throw new Error(`sign-in teknisi uji gagal: ${signErr.message}`);
    await sleep(500);

    const reject = await techClient.rpc("claim_job", { p_booking: mismatch.data.id });
    const accept = await techClient.rpc("claim_job", { p_booking: match.data.id });

    // Cek langsung di DB: pekerjaan salah kategori TIDAK BOLEH terklaim.
    const { data: mismatchRow } = await admin.from("bookings").select("technician_id").eq("id", mismatch.data.id).single();
    const claimedMismatch = Boolean(mismatchRow?.technician_id);
    const rejectedMismatch = reject.data?.ok === false && !claimedMismatch;
    const acceptedMatch = accept.data?.ok === true;

    await techClient.auth.signOut();

    if (rejectedMismatch && acceptedMatch) {
      report(
        "F4",
        "claim_job guard keahlian",
        "TERTUTUP",
        `Pekerjaan kategori "${catName(serviceB.category_id)}" DITOLAK (${reject.data?.error ?? "ok=false"}) dan kategori "${catName(serviceA.category_id)}" diterima → guard technician_matches_service hidup.`
      );
    } else {
      report(
        "F4",
        "claim_job guard keahlian",
        "TERBUKA",
        `mismatch ditolak=${rejectedMismatch} (terklaim=${claimedMismatch}), match diterima=${acceptedMatch} (${accept.data?.error ?? "ok"}). Jalankan supabase/migrate-technician-skill-filter.sql.`
      );
    }

    // ---------------- F5: review untuk pesanan yang belum selesai ----------------
    const pending = await admin
      .from("bookings")
      .insert(
        probeBooking({ profileId: customer.id, serviceId: serviceA.id }, `AUDIT-F5-${stamp}`, {
          status: "pending",
          technician_id: technician.id,
        })
      )
      .select("id")
      .single();
    if (pending.error) throw new Error(`gagal membuat pesanan uji F5: ${pending.error.message}`);
    probeIds.push(pending.data.id);

    const custClient = makeUserClient(env);
    const { error: cSignErr } = await custClient.auth.signInWithPassword({ email: customer.email, password: customer.password });
    if (cSignErr) throw new Error(`sign-in pelanggan uji gagal: ${cSignErr.message}`);
    await sleep(500);

    // CATATAN: tabel `reviews` live dibuat via Table Editor dan TIDAK punya
    // kolom id/created_at (drift dari migrate-reviews.sql). Karena itu JANGAN
    // pakai `.select("id")` — PostgREST gagal di tahap validasi kolom dan
    // hasilnya jadi false positive. Verifikasi dilakukan lewat baca balik
    // sebagai service-role.
    const review = await custClient.from("reviews").insert({
      booking_id: pending.data.id,
      user_id: customer.id,
      technician_id: technician.id,
      rating: 5,
      comment: "AUDIT F5 — review untuk pesanan yang belum selesai",
    });
    await custClient.auth.signOut();

    const { data: written } = await admin
      .from("reviews")
      .select("booking_id,user_id,rating")
      .eq("booking_id", pending.data.id);
    const reallyWritten = (written?.length ?? 0) > 0;
    if (reallyWritten) reviewIds.push(pending.data.id); // hapus by booking_id

    const errMsg = review.error?.message ?? "";
    const schemaError = /column .* does not exist/i.test(errMsg);

    // ---------------- Kontrol positif: pesanan SELESAI harus tetap bisa dinilai ----------------
    // Tanpa ini, probe bisa melaporkan "TERTUTUP" padahal policy-nya malah
    // mematahkan jalur review yang sah (regresi).
    const completed = await admin
      .from("bookings")
      .insert(
        probeBooking({ profileId: customer.id, serviceId: serviceA.id }, `AUDIT-F5-OK-${stamp}`, {
          status: "completed",
          technician_id: technician.id,
        })
      )
      .select("id")
      .single();
    if (completed.error) throw new Error(`gagal membuat pesanan selesai uji F5: ${completed.error.message}`);
    probeIds.push(completed.data.id);

    const custOk = makeUserClient(env);
    const { error: okSignErr } = await custOk.auth.signInWithPassword({ email: customer.email, password: customer.password });
    if (okSignErr) throw new Error(`sign-in pelanggan uji (kontrol positif) gagal: ${okSignErr.message}`);
    await sleep(500);
    const okReview = await custOk.from("reviews").insert({
      booking_id: completed.data.id,
      user_id: customer.id,
      technician_id: technician.id,
      rating: 4,
      comment: "AUDIT F5 kontrol positif — pesanan selesai",
    });
    const { data: okWritten } = await admin
      .from("reviews")
      .select("booking_id,rating")
      .eq("booking_id", completed.data.id);
    const positiveOk = (okWritten?.length ?? 0) > 0;
    if (positiveOk) reviewIds.push(completed.data.id);
    const okErrMsg = okReview.error?.message ?? "";

    // ---------------- Kontrol UPDATE: pemilik boleh ubah review pesanan SELESAI ----------------
    let updateOwnOk = false;
    if (positiveOk) {
      const okUpdate = await custOk
        .from("reviews")
        .update({ rating: 5 })
        .eq("booking_id", completed.data.id);
      const { data: after } = await admin
        .from("reviews")
        .select("rating")
        .eq("booking_id", completed.data.id)
        .maybeSingle();
      updateOwnOk = !okUpdate.error && after?.rating === 5;
    }

    // ---------------- Kontrol negatif UPDATE: review lama pada pesanan BELUM selesai ----------------
    // Baris "warisan" dibuat lewat service-role (melewati RLS) supaya bisa menguji
    // policy UPDATE: pelanggan TIDAK boleh mengubahnya selama pesanan belum selesai.
    const forged = await admin
      .from("bookings")
      .insert(
        probeBooking({ profileId: customer.id, serviceId: serviceA.id }, `AUDIT-F5-FORGED-${stamp}`, {
          status: "pending",
          technician_id: technician.id,
        })
      )
      .select("id")
      .single();
    if (forged.error) throw new Error(`gagal membuat pesanan uji F5 (UPDATE): ${forged.error.message}`);
    probeIds.push(forged.data.id);
    const forgedInsert = await admin.from("reviews").insert({
      booking_id: forged.data.id,
      user_id: customer.id,
      technician_id: technician.id,
      rating: 1,
      comment: "AUDIT F5 — baris warisan pada pesanan pending",
    });
    if (forgedInsert.error) throw new Error(`gagal menyiapkan baris review warisan: ${forgedInsert.error.message}`);
    reviewIds.push(forged.data.id);

    const forgedUpdate = await custOk
      .from("reviews")
      .update({ rating: 5 })
      .eq("booking_id", forged.data.id);
    const { data: forgedAfter } = await admin
      .from("reviews")
      .select("rating")
      .eq("booking_id", forged.data.id)
      .maybeSingle();
    // PENTING: RLS pada UPDATE memblokir secara SENYAP — PostgREST balas tanpa
    // error dan 0 baris terpengaruh. Jadi penilaian HARUS berbasis nilai hasil
    // baca-ulang, bukan ada/tidaknya error.
    const forgedStillThere = forgedAfter != null;
    const forgedChanged = forgedAfter?.rating === 5;
    const negativeUpdateBlocked = forgedStillThere && !forgedChanged;
    const silentBlock = negativeUpdateBlocked && !forgedUpdate.error;

    await custOk.auth.signOut();

    report(
      "F5b",
      "Policy UPDATE review",
      !forgedStillThere
        ? "TIDAK_DIUJI"
        : forgedChanged
          ? "TERBUKA"
          : updateOwnOk
            ? "TERTUTUP"
            : "REGRESI",
      !forgedStillThere
        ? "baris review warisan uji hilang — perlu tinjauan manual."
        : forgedChanged
          ? `Pelanggan masih bisa MENGUBAH review miliknya pada pesanan 'pending' via API langsung (rating berubah 1 → ${forgedAfter?.rating}) → jalankan blok UPDATE di supabase/fix-reviews-guard.sql.`
          : updateOwnOk
            ? `Ubah review pesanan 'pending' TIDAK berdampak (rating tetap ${forgedAfter?.rating}; ${silentBlock ? "diblokir senyap oleh RLS, tanpa error" : `error: ${forgedUpdate.error?.message}`}), sedangkan ubah review pesanan 'completed' tetap DITERIMA (kontrol positif ✔).`
            : `Ubah review pesanan 'pending' tidak berdampak ✔ tapi ubah review pesanan 'completed' ikut GAGAL ✖ (${silentBlock ? "diblokir senyap" : "error"}) → policy UPDATE terlalu ketat, jalur sah pelanggan rusak.`
    );

    if (reallyWritten) {
      report(
        "F5",
        "Review tanpa pesanan selesai",
        "TERBUKA",
        `INSERT review untuk pesanan berstatus 'pending' BERHASIL via API langsung → policy "user can insert own review" perlu cek bookings.status='completed'. Jalankan supabase/fix-reviews-guard.sql.`
      );
    } else if (review.error && schemaError) {
      report("F5", "Review tanpa pesanan selesai", "TIDAK_DIUJI", `probe tidak valid: ${errMsg}`);
    } else if (!positiveOk) {
      // Negatif ditolak, tapi positif juga ditolak → policy terlalu ketat / ada regresi.
      report(
        "F5",
        "Review tanpa pesanan selesai",
        "REGRESI",
        `Review pesanan 'pending' ditolak ✔, TAPI review pesanan 'completed' ikut DITOLAK ✖ (${okErrMsg || "baris tidak terbaca"}) → policy fix-reviews-guard.sql terlalu ketat; periksa kondisi technician_id/status.`
      );
    } else {
      report(
        "F5",
        "Review tanpa pesanan selesai",
        "TERTUTUP",
        `Review pesanan 'pending' DITOLAK (${errMsg}) sementara review pesanan 'completed' tetap DITERIMA (kontrol positif ✔) → policy sudah benar, jalur sah pelanggan tidak rusak.`
      );
    }
    return { customer, technician };
  } finally {
    // reviews tidak punya kolom id (lihat catatan F5) → hapus berdasarkan booking_id.
    for (const bookingId of reviewIds) await admin.from("reviews").delete().eq("booking_id", bookingId);
    for (const id of probeIds) await admin.from("bookings").delete().eq("id", id);
    const { count: leftover } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .like("code", "AUDIT-%");
    console.log(`   sisa baris uji (AUDIT-*): ${leftover ?? "?"}`);
    const del = await deleteTempUsers(admin, tempUsers);
    for (const r of del) console.log(`   pembersihan akun uji ${r.label}: ${r.ok ? "OK" : `GAGAL (${r.error})`}`);
  }
}

/**
 * Paritas skema (READ-ONLY, informatif): tabel `reviews` di produksi dibuat
 * lewat Table Editor tanpa kolom id/created_at. App tidak memakainya, jadi ini
 * dilaporkan sebagai INFO — bukan kegagalan gate — tetapi drift-nya perlu
 * diketahui karena `select("id")` pada reviews akan gagal (pernah membuat probe
 * F5 memberi false positive).
 */
async function checkSchemaParity(admin) {
  const has = async (table, column) => {
    const { error } = await admin.from(table).select(column).limit(1);
    return !error;
  };
  const id = await has("reviews", "id");
  const createdAt = await has("reviews", "created_at");
  if (id && createdAt) {
    report("F9", "Paritas skema reviews (id + created_at)", "TERTUTUP", "Kedua kolom ada — konsisten dengan migrate-reviews.sql.");
  } else {
    report(
      "F9",
      "Paritas skema reviews (id + created_at)",
      "INFO",
      `Drift ringan: id=${id ? "ada" : "TIDAK ADA"}, created_at=${createdAt ? "ada" : "TIDAK ADA"} — app tidak memakainya, tapi jalankan supabase/migrate-reviews-schema-parity.sql bila ingin seragam.`
    );
  }
}

async function main() {
  const env = loadEnv();
  const admin = makeAdminClient(env);
  const { data: profile, error: pErr } = await admin.from("profiles").select("id").limit(1).maybeSingle();
  const { data: service, error: sErr } = await admin.from("services").select("id").limit(1).maybeSingle();
  if (pErr || sErr) throw new Error(pErr?.message || sErr?.message);
  if (!profile || !service) throw new Error("butuh minimal 1 baris profiles & services sebagai fixture");
  const fixtures = { profileId: profile.id, serviceId: service.id };

  console.log("AUDIT LIVE F3–F6 (semua data uji dibersihkan sendiri)");
  console.log("=".repeat(70));
  await checkF3(env, admin);
  await checkF6(admin, fixtures);
  await checkF4F5(admin, env, fixtures);
  await checkSchemaParity(admin);
  console.log("=".repeat(70));
  console.log(`TERTUTUP: ${closed.join(", ") || "-"}`);
  console.log(`TERBUKA : ${open.join(", ") || "-"}`);
  process.exit(open.length === 0 ? 0 : 5);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
