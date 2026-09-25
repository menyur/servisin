import { formatRupiah } from "@/lib/pricing";

/**
 * Struk pesanan untuk dicetak (window.print()).
 * Style inline + class print-only — area lain halaman disembunyikan saat cetak
 * lewat aturan @media print di globals.css.
 */
export default function ReceiptContent({ booking, customerName, customerPhone }) {
  const b = booking;
  const created = b.created_at ? new Date(b.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "-";

  return (
    <div className="receipt-root" style={{ fontFamily: "'Inter', sans-serif", color: "#10202B" }}>
      {/* Kepala struk */}
      <div style={{ textAlign: "center", borderBottom: "2px dashed #D7E7F0", paddingBottom: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ display: "inline-block", width: 28, height: 28, borderRadius: 7, backgroundColor: "#1C86C7", lineHeight: "28px", color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {/* ikon wrench sederhana */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle" }}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          </span>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#0B3556" }}>Fixify</span>
        </div>
        <div style={{ fontSize: 11, color: "#4C6272" }}>Platform Pemesanan Jasa Serba Bisa</div>
        <div style={{ fontSize: 11, color: "#4C6272" }}>Struk Pesanan</div>
      </div>

      {/* Info pesanan */}
      <table width="100%" style={{ fontSize: 12, borderCollapse: "collapse", marginBottom: 14 }}>
        <tbody>
          <tr><td style={{ padding: "3px 0", color: "#4C6272", width: 130 }}>Kode Pesanan</td><td style={{ fontWeight: 700, color: "#0B3556", fontSize: 14 }}>{b.code}</td></tr>
          <tr><td style={{ padding: "3px 0", color: "#4C6272" }}>Tanggal Cetak</td><td>{created}</td></tr>
          <tr><td style={{ padding: "3px 0", color: "#4C6272" }}>Nama Pelanggan</td><td>{customerName || "-"}</td></tr>
          <tr><td style={{ padding: "3px 0", color: "#4C6272" }}>Telepon</td><td>{customerPhone || "-"}</td></tr>
          <tr><td style={{ padding: "3px 0", color: "#4C6272" }}>Layanan</td><td>{b.services?.name || "-"}{b.option_label ? ` — ${b.option_label}` : ""}</td></tr>
          <tr><td style={{ padding: "3px 0", color: "#4C6272" }}>Jadwal</td><td>{b.booking_date} · {b.booking_time}</td></tr>
          <tr><td style={{ padding: "3px 0", color: "#4C6272", verticalAlign: "top" }}>Alamat</td><td>{b.address}</td></tr>
          <tr><td style={{ padding: "3px 0", color: "#4C6272" }}>Metode Bayar</td><td>{paymentLabel(b.payment_method)}</td></tr>
          <tr><td style={{ padding: "3px 0", color: "#4C6272" }}>Status Bayar</td><td style={{ fontWeight: 600, color: isPaid(b) ? "#2C8F63" : "#C97F16" }}>{paymentStatusLabel(b)}</td></tr>
          <tr><td style={{ padding: "3px 0", color: "#4C6272" }}>Status</td><td style={{ textTransform: "capitalize" }}>{statusLabel(b.status)}</td></tr>
          {b.technician?.name && (
            <>
              <tr><td style={{ padding: "3px 0", color: "#4C6272" }}>Teknisi</td><td style={{ fontWeight: 600, color: "#0B3556" }}>{b.technician.name}</td></tr>
              {b.technician.phone && (
                <tr><td style={{ padding: "3px 0", color: "#4C6272" }}>Kontak Teknisi</td><td>{b.technician.phone}</td></tr>
              )}
            </>
          )}
        </tbody>
      </table>

      {/* Rincian biaya */}
      <div style={{ borderTop: "2px dashed #D7E7F0", paddingTop: 12, marginBottom: 14 }}>
        <table width="100%" style={{ fontSize: 13, borderCollapse: "collapse" }}>
          <tbody>
            <tr><td style={{ padding: "4px 0" }}>Subtotal layanan</td><td style={{ textAlign: "right" }}>{formatRupiah(b.subtotal_price)}</td></tr>
            <tr><td style={{ padding: "4px 0" }}>Biaya aplikasi</td><td style={{ textAlign: "right" }}>{formatRupiah(b.app_fee)}</td></tr>
            {Number(b.discount_amount) > 0 && (
              <tr>
                <td style={{ padding: "4px 0", color: "#2C8F63" }}>Diskon voucher</td>
                <td style={{ textAlign: "right", color: "#2C8F63" }}>- {formatRupiah(b.discount_amount)}</td>
              </tr>
            )}
            <tr style={{ borderTop: "1px solid #D7E7F0" }}>
              <td style={{ padding: "8px 0 0 0", fontWeight: 700, color: "#0B3556" }}>TOTAL</td>
              <td style={{ textAlign: "right", fontWeight: 700, color: "#0B3556", fontSize: 16, padding: "8px 0 0 0" }}>{formatRupiah(b.total_price)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Detail pembayaran */}
      <div style={{ border: "1px solid #D7E7F0", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: "#0B3556", fontSize: 11, marginBottom: 4 }}>Detail Pembayaran</div>
        <table width="100%" style={{ fontSize: 11, borderCollapse: "collapse" }}>
          <tbody>
            <tr><td style={{ padding: "2px 0", color: "#4C6272", width: 110 }}>Metode</td><td>{paymentLabel(b.payment_method)}</td></tr>
            <tr><td style={{ padding: "2px 0", color: "#4C6272" }}>Status</td><td style={{ fontWeight: 600, color: isPaid(b) ? "#2C8F63" : "#C97F16" }}>{paymentStatusLabel(b)}</td></tr>
            <tr><td style={{ padding: "2px 0", color: "#4C6272" }}>Total dibayar</td><td style={{ fontWeight: 700 }}>{formatRupiah(b.total_price)}</td></tr>
            {b.payment_method === "cod" && (
              <tr><td style={{ padding: "2px 0", color: "#4C6272", verticalAlign: "top" }}>Keterangan</td><td>Dibayar tunai di lokasi setelah pengerjaan selesai</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Catatan */}
      {b.notes && (
        <div style={{ fontSize: 11, color: "#4C6272", marginBottom: 14 }}>
          <div style={{ fontWeight: 600, color: "#0B3556", marginBottom: 2 }}>Catatan:</div>
          {b.notes}
        </div>
      )}

      {!b.technician?.name && (
        <div style={{ fontSize: 11, color: "#4C6272", marginBottom: 14, fontStyle: "italic" }}>
          Teknisi belum ditugaskan untuk pesanan ini.
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: 10, color: "#4C6272", borderTop: "2px dashed #D7E7F0", paddingTop: 12 }}>
        <div style={{ fontWeight: 600, color: "#0B3556", marginBottom: 2 }}>Terima kasih sudah memesan di Fixify!</div>
        <div>Simpan struk ini sebagai bukti pesanan. Butuh bantuan? Hubungi kami lewat halaman Tentang Kami.</div>
        <div style={{ marginTop: 6, fontStyle: "italic" }}>Dicetak dari dashboard pelanggan · {created}</div>
      </div>
    </div>
  );
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
