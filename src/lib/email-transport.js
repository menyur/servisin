/**
 * Transport email mentah: SATU-SATUNYA tempat yang memanggil Resend.
 *
 * Dipakai dua jalur yang tidak boleh menyalin logika satu sama lain:
 *   - src/lib/email.js      → pengiriman biasa (setelah gerbang data uji)
 *   - src/lib/email-antrean.js → pengiriman ULANG pesan yang tertunda
 *
 * Kenapa dipisah: mengembalikan `{ data, error }` (SDK Resend TIDAK melempar
 * untuk error API — kunci salah, domain belum terverifikasi, penerima ditolak,
 * KUOTA HARIAN habis). Dulu hasilnya diabaikan sehingga pengiriman GAGAL
 * dilaporkan "terkirim". Sekarang `error` selalu dikembalikan ke pemanggil.
 *
 * Tanpa RESEND_API_KEY, pengiriman TIDAK dilakukan (hanya dicatat ke log) dan
 * hasilnya ditandai `simulated` — supaya tidak ada yang menyangka terkirim.
 */

/**
 * @param {{to: string|string[], subject: string, html: string, attachments?: object[]}} o
 * @returns {Promise<{simulated: boolean, id?: string, error?: string, to?: string[]}>}
 */
export async function kirimLewatResend({ to, subject, html, attachments }) {
  const penerima = (Array.isArray(to) ? to : [to]).map((a) => String(a ?? "").trim()).filter(Boolean);

  if (!process.env.RESEND_API_KEY) {
    console.log("[email disimulasikan — RESEND_API_KEY belum diisi]");
    console.log(
      `To: ${penerima.join(", ")}\nSubject: ${subject}${attachments?.length ? `\nAttachments: ${attachments.map((a) => a.filename).join(", ")}` : ""}`
    );
    return { simulated: true };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "Fixify <onboarding@resend.dev>",
      to: penerima,
      subject,
      html,
      ...(attachments?.length ? { attachments } : {}),
    });
    if (error) {
      const detail = `${error.name || "error"}: ${error.message || "tanpa pesan"}`;
      console.error("Gagal mengirim email:", detail);
      return { simulated: false, error: detail, to: penerima };
    }
    // `id` dipakai uji verify:email-send untuk membuktikan Resend benar-benar
    // MENERIMA pesannya (bukan sekadar env terbaca).
    return { simulated: false, id: data?.id, to: penerima };
  } catch (err) {
    // Kegagalan jaringan/import — tidak terkirim, tapi bukan "simulasi".
    console.error("Gagal mengirim email:", err.message);
    return { simulated: false, error: err.message, to: penerima };
  }
}
