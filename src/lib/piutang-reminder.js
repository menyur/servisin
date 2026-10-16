/**
 * PENGINGAT OTOMATIS PIUTANG JATUH TEMPO.
 *
 * Piutang teknisi (saldo minus) yang menua tidak akan lunas sendiri: teknisi yang
 * masih bekerja tertahan gerbang klaim sampai menyetor, sedangkan teknisi yang
 * BERHENTI tidak akan pernah menyetor. Pengingat manual dari tab Saldo tidak
 * menjangkau kasus kedua — tidak ada yang membuka tab itu untuk teknisi yang
 * sudah lama tidak muncul. Karena itu pengingat ini berjalan terjadwal.
 *
 * Berkas ini hanya URUSAN I/O:
 *   1. baca piutang terbuka + umurnya (src/lib/piutang.js — sumber yang sama
 *      dengan panel admin, jadi yang diingatkan = yang dilaporkan);
 *   2. serahkan pemilihan penerima ke aturan MURNI `pilihPengingatPiutang`
 *      (src/lib/pricing.js) supaya bisa dibuktikan offline tanpa DB/jaringan;
 *   3. tandai `profiles.balance_reminder_at` (banner di aplikasi teknisi +
 *      penjaga idempotensi) lalu kirim push & email lewat jalur yang SAMA dengan
 *      pengingat manual admin (`remindTechnicianBalanceAdmin`).
 *
 * Dijalankan oleh route cron `/api/cron/piutang-reminder` (lihat vercel.json).
 */
// Impor relatif (bukan alias `@/`) supaya probe hidup
// (scripts/verify-piutang-writeoff.mjs --live) bisa memanggil jalur ini langsung
// dengan Node — sama seperti src/lib/notify.js → ./push.js.
import { pilihPengingatPiutang, ambangPiutangHari, PIUTANG_ULANG_INGAT_HARI } from "./pricing.js";
import { bacaPiutangTerbuka } from "./piutang.js";
// Lewat jembatan notifikasi (web push + FCM), sama seperti pengingat manual admin:
// teknisi Android harus tetap menerima walau aplikasinya tertutup.
import { sendPushToUser } from "./notify.js";
import { sendTechnicianBalanceReminderEmail } from "./email.js";

/**
 * Pilih + ingatkan teknisi yang piutangnya sudah lewat ambang.
 *
 * @param supabase  klien service-role (dipakai dari cron; tak butuh sesi admin)
 * @param hari      ambang jatuh tempo (hari); default dari `ambangPiutangHari()`
 * @param ulangHari jeda minimal antar pengingat; default PIUTANG_ULANG_INGAT_HARI
 * @param kirim     false = hanya hitung & tandai tanpa push/email (untuk uji)
 * @param dry       true  = hanya hitung, tidak menulis apa pun
 */
export async function jalankanPengingatPiutang(
  supabase,
  { hari, ulangHari, kirim = true, dry = false, sekarang = new Date() } = {}
) {
  const baca = await bacaPiutangTerbuka(supabase);
  if (baca.error) return { error: baca.error };

  const ambang = Number(hari) > 0 ? Math.round(Number(hari)) : ambangPiutangHari();
  const ulang = Number(ulangHari) > 0 ? Math.round(Number(ulangHari)) : PIUTANG_ULANG_INGAT_HARI;

  const ids = [...baca.perTeknisi.keys()];
  if (!ids.length) {
    return { ambangHari: ambang, ulangHari: ulang, total: 0, dikirim: [], dilewati: [], belumJatuhTempo: [], dry };
  }

  const { data: profs, error: profErr } = await supabase
    .from("profiles")
    .select("id, name, email, balance, approval_status, balance_reminder_at")
    .in("id", ids);
  if (profErr) return { error: profErr.message };

  const pilihan = pilihPengingatPiutang({
    teknisi: (profs || []).map((p) => ({
      id: p.id,
      nama: p.name || p.email || String(p.id).slice(0, 8),
      email: p.email || null,
      saldo: Number(p.balance || 0),
      masihAktif: p.approval_status === "approved",
      reminderTerakhir: p.balance_reminder_at || null,
      items: baca.perTeknisi.get(p.id)?.items || [],
    })),
    ambangHari: ambang,
    ulangHari: ulang,
    sekarang: sekarang.getTime(),
  });

  const dikirim = [];
  for (const d of pilihan.kirim) {
    if (!dry) {
      // Penanda untuk aplikasi teknisi (banner) DAN penjaga idempotensi cron.
      const { error: stampErr } = await supabase
        .from("profiles")
        .update({ balance_reminder_at: sekarang.toISOString() })
        .eq("id", d.id);
      if (stampErr && !/column .* does not exist|schema cache/i.test(stampErr.message || "")) {
        return { error: `gagal menyimpan penanda pengingat: ${stampErr.message}` };
      }

      if (kirim) {
        await sendPushToUser(d.id, {
          title: "Piutangmu jatuh tempo",
          body:
            `Saldo teknisimu minus ${d.jatuhTempo} sejak ${d.tertuaJatuhTempo} hari lalu. ` +
            "Ajukan setor untuk menutupnya; setoran menutup kekurangan lebih dulu.",
          url: "/technician",
          event: "balance_reminder",
        });
        if (d.email) {
          await sendTechnicianBalanceReminderEmail(d.email, {
            name: d.nama,
            balance: d.saldo,
            piutang: d.jatuhTempo,
            umurHari: d.tertuaJatuhTempo,
          });
        }
      }
    }

    dikirim.push({
      id: d.id,
      nama: d.nama,
      total: d.umur.total,
      jatuhTempo: d.jatuhTempo,
      tertua: d.umur.tertua,
      // Keranjang umur ikut dilaporkan supaya operator bisa menilai sendiri
      // piutang ini sudah menua berapa lama (mis. lewat `?dry=1`).
      buckets: d.umur.buckets,
      saldo: d.saldo,
      email: d.email,
      push: Boolean(kirim),
    });
  }

  return {
    ambangHari: ambang,
    ulangHari: ulang,
    total: dikirim.length + pilihan.dilewati.length,
    dikirim,
    dilewati: pilihan.dilewati,
    belumJatuhTempo: pilihan.belumJatuhTempo,
    dry,
  };
}
