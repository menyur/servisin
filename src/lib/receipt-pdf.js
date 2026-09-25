/**
 * Generator struk PDF di sisi server (pdfkit).
 * Layout meniru ReceiptContent (struk cetak di dashboard pelanggan).
 * Mengembalikan Buffer siap dilampirkan ke email (base64).
 */
import PDFDocument from "pdfkit";

function money(doc, left, right, bold = false) {
  doc
    .font(bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(bold ? 11 : 10)
    .fillColor(bold ? "#0B3556" : "#10202B")
    .text(left, 48, doc.y, { continued: false, lineGap: 3 });
  doc
    .font(bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(bold ? 11 : 10)
    .fillColor(bold ? "#0B3556" : "#10202B")
    .text(right, 48, doc.y, { align: "right", lineGap: 3 });
}

function row(doc, label, value, bold = false) {
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#4C6272")
    .text(label, 48, doc.y, { continued: false, lineGap: 2.5 });
  doc
    .font(bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(bold ? 11 : 9.5)
    .fillColor(bold ? "#0B3556" : "#10202B")
    .text(value, 150, doc.y - (bold ? 1.5 : 0.5), { lineGap: 2.5 });
}

export function buildReceiptPdf({ booking, customerName, customerPhone }) {
  const doc = new PDFDocument({ size: "A5", margin: 48, bufferPages: true });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const b = booking;
  const created = b.created_at
    ? new Date(b.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
    : "-";
  const rupiah = (n) =>
    new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n) || 0);

  // ---------- kepala ----------
  doc
    .roundedRect(194, 42, 24, 24, 6)
    .fillAndStroke("#1C86C7", "#1C86C7");
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(13).text("S", 194, 49, { width: 24, align: "center" });
  doc.fillColor("#0B3556").font("Helvetica-Bold").fontSize(18).text("Fixify", 226, 47);
  doc.fillColor("#4C6272").font("Helvetica").fontSize(8.5)
    .text("Platform Pemesanan Jasa Serba Bisa — Struk Pesanan", 48, 74, { width: doc.page.width - 96, align: "center" });

  // garis putus-putus
  doc.moveTo(48, 92).lineTo(doc.page.width - 48, 92).dash(3, { space: 3 }).strokeColor("#D7E7F0").stroke().undash();
  doc.y = 100;

  // ---------- info pesanan ----------
  row(doc, "Kode Pesanan", b.code, true);
  row(doc, "Tanggal Cetak", created);
  row(doc, "Nama Pelanggan", customerName || "-");
  row(doc, "Telepon", customerPhone || "-");
  row(doc, "Layanan", b.services?.name || "-");
  row(doc, "Jadwal", `${b.booking_date} · ${b.booking_time}`);
  row(doc, "Alamat", b.address);
  row(doc, "Metode Bayar", paymentLabel(b.payment_method));
  doc.font("Helvetica-Bold").fontSize(9.5)
    .fillColor(isPaid(b) ? "#2C8F63" : "#C97F16")
    .text("Status Bayar", 48, doc.y, { lineGap: 2.5 });
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(isPaid(b) ? "#2C8F63" : "#C97F16")
    .text(paymentStatusLabel(b), 150, doc.y, { lineGap: 2.5 });
  row(doc, "Status", statusLabel(b.status));
  if (b.technician?.name) {
    row(doc, "Teknisi", b.technician.name, true);
    if (b.technician.phone) row(doc, "Kontak Teknisi", b.technician.phone);
  } else {
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#4C6272")
      .text("Teknisi belum ditugaskan untuk pesanan ini.", 48, doc.y, { lineGap: 3 });
  }

  // ---------- rincian biaya ----------
  doc.moveTo(48, doc.y + 8).lineTo(doc.page.width - 48, doc.y + 8).dash(3, { space: 3 }).strokeColor("#D7E7F0").stroke().undash();
  doc.y += 16;
  money(doc, "Subtotal layanan", rupiah(b.subtotal_price));
  money(doc, "Biaya aplikasi", rupiah(b.app_fee));
  if (Number(b.discount_amount) > 0) {
    doc.fillColor("#2C8F63");
    money(doc, "Diskon voucher", "- " + rupiah(b.discount_amount));
    doc.fillColor("#10202B");
  }
  doc.moveTo(48, doc.y + 6).lineTo(doc.page.width - 48, doc.y + 6).strokeColor("#D7E7F0").stroke();
  doc.y += 12;
  money(doc, "TOTAL", rupiah(b.total_price), true);

  // ---------- detail pembayaran ----------
  doc.y += 6;
  doc.roundedRect(48, doc.y, doc.page.width - 96, 54, 6).lineWidth(1).strokeColor("#D7E7F0").stroke();
  doc.y += 8;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0B3556").text("DETAIL PEMBAYARAN", 56, doc.y);
  doc.y += 12;
  const payRows = [
    ["Metode", paymentLabel(b.payment_method)],
    ["Status", paymentStatusLabel(b)],
    ["Total dibayar", rupiah(b.total_price)],
  ];
  for (const [label, value] of payRows) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#4C6272").text(label, 56, doc.y, { lineGap: 2 });
    doc.font("Helvetica").fontSize(8.5).fillColor("#10202B").text(value, 130, doc.y, { lineGap: 2 });
    doc.y += 11;
  }
  if (b.payment_method === "cod") {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#4C6272")
      .text("Dibayar tunai di lokasi setelah pengerjaan selesai.", 56, doc.y, { width: doc.page.width - 120, lineGap: 2 });
  }
  doc.y += 8;

  // ---------- catatan ----------
  if (b.notes) {
    doc.y += 8;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0B3556").text("Catatan:", 48, doc.y);
    doc.font("Helvetica").fontSize(8.5).fillColor("#4C6272").text(b.notes, 48, doc.y + 2, { width: doc.page.width - 96 });
  }

  // ---------- footer ----------
  doc.y = doc.page.height - 78;
  doc.moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).dash(3, { space: 3 }).strokeColor("#D7E7F0").stroke().undash();
  doc.y += 10;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0B3556")
    .text("Terima kasih sudah memesan di Fixify!", 48, doc.y, { width: doc.page.width - 96, align: "center" });
  doc.font("Helvetica").fontSize(7.5).fillColor("#4C6272")
    .text("Simpan PDF ini sebagai bukti pesanan. Butuh bantuan? Hubungi kami lewat halaman Tentang Kami.", 48, doc.y + 12, { width: doc.page.width - 96, align: "center" });
  doc.font("Helvetica-Oblique").fontSize(7.5)
    .text(`Dikirim otomatis saat pesanan selesai · ${created}`, 48, doc.y + 24, { width: doc.page.width - 96, align: "center" });

  doc.end();
  return done;
}

function paymentLabel(m) {
  return { qris: "QRIS", virtual_account: "Virtual Account", e_wallet: "E-Wallet", cod: "Cash on Delivery" }[m] || m || "-";
}

function isPaid(b) {
  return b.status === "paid" || b.status === "completed";
}

function paymentStatusLabel(b) {
  if (b.status === "paid") return "Lunas";
  if (b.status === "completed") return b.payment_method === "cod" ? "Lunas (tunai di lokasi)" : "Lunas";
  if (b.status === "cancelled") return "Dibatalkan";
  return b.payment_method === "cod" ? "Menunggu — bayar tunai di lokasi" : "Menunggu pembayaran";
}

function statusLabel(s) {
  return { pending: "Menunggu Pembayaran", paid: "Dibayar", in_progress: "Dikerjakan", completed: "Selesai", cancelled: "Dibatalkan" }[s] || s || "-";
}
