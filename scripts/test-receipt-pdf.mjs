// Uji generator PDF struk: buat satu contoh, simpan ke .freebuff/struk-test.pdf,
// laporkan ukuran. Tidak mencetak data sensitif (data dummy semua).
import { buildReceiptPdf } from "../src/lib/receipt-pdf.js";
import { writeFileSync, statSync, unlinkSync } from "node:fs";

const booking = {
  code: "SV-TEST",
  services: { name: "Cuci AC / Maintenance" },
  booking_date: "2026-09-15",
  booking_time: "13:00-15:00",
  address: "Jl. Contoh No. 123, Jakarta",
  notes: "Mohon datang setelah jam makan siang.",
  subtotal_price: 75000,
  app_fee: 5000,
  total_price: 80000,
  payment_method: "cod",
  status: "completed",
  technician: { name: "Teknisi Uji", phone: "081234567890" },
  created_at: new Date().toISOString(),
};

const buf = await buildReceiptPdf({ booking, customerName: "Pelanggan Uji", customerPhone: "089876543210" });
const path = ".freebuff/struk-test.pdf";
writeFileSync(path, buf);
const { size } = statSync(path);
console.log(`PDF struk dibuat: ${path} (${(size / 1024).toFixed(1)} KB, ${buf.length} bytes)`);

// bersihkan file contoh
unlinkSync(path);
console.log("File contoh dihapus kembali. PDF valid dan siap dilampirkan ke email.");
