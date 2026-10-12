import Link from "next/link";
import LegalPage, { LegalSection, LegalList } from "@/components/LegalPage";
import { formatRupiah, APP_FEE, REVIEW_INCENTIVE_AMOUNT } from "@/lib/pricing";

export const metadata = {
  title: "Syarat dan Ketentuan — Fixify",
  description:
    "Aturan penggunaan platform Fixify untuk pelanggan dan teknisi: akun, pemesanan, pembayaran, pembatalan, dan tanggung jawab.",
  alternates: { canonical: "/syarat" },
};

const KONTAK_EMAIL = "halo@fixify.id";
const BERLAKU = "12 Oktober 2026";

export default function SyaratKetentuanPage() {
  return (
    <LegalPage
      eyebrow="Dokumen legal"
      title="Syarat dan Ketentuan"
      updatedAt={BERLAKU}
      intro={
        <>
          Syarat dan Ketentuan ini mengatur penggunaan situs, aplikasi Android, dan layanan Fixify.
          Harap dibaca dengan saksama. Dengan membuat akun atau memesan layanan, kamu menyatakan telah
          membaca, memahami, dan menyetujui ketentuan berikut.
        </>
      }
    >
      <LegalSection id="definisi" title="1. Definisi">
        <LegalList>
          <li><strong>Fixify</strong> — platform yang menghubungkan pelanggan dengan teknisi lewat situs dan aplikasi Android Fixify.</li>
          <li><strong>Pelanggan</strong> — pengguna yang memesan layanan.</li>
          <li><strong>Teknisi</strong> — penyedia jasa terkurasi yang mengerjakan pesanan.</li>
          <li><strong>Layanan</strong> — jasa yang dipesan, misalnya service AC, tukang rumah, service kendaraan, kebersihan dan laundry.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="akun" title="2. Akun">
        <LegalList>
          <li>Kamu wajib berusia minimal 18 tahun dan memberikan data yang benar serta mutakhir.</li>
          <li>Kamu bertanggung jawab menjaga kerahasiaan kata sandi dan seluruh aktivitas pada akunmu.</li>
          <li>Kami dapat meminta verifikasi tambahan, misalnya dokumen identitas bagi teknisi.</li>
          <li>Kamu dapat masuk memakai akun Google; ketentuan data dijelaskan di{" "}
            <Link href="/privasi" className="text-brand underline">Kebijakan Privasi</Link>.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="peran" title="3. Peran Fixify">
        <p>
          Fixify adalah penyedia platform yang mempertemukan pelanggan dan teknisi. Pekerjaan jasa
          dilakukan oleh teknisi. Fixify berperan dalam kurasi teknisi, pengelolaan pemesanan,
          pembayaran, penagihan biaya aplikasi, serta penanganan laporan dan sengketa.
        </p>
      </LegalSection>

      <LegalSection id="pemesanan" title="4. Pemesanan dan harga">
        <LegalList>
          <li>Harga ditentukan oleh sistem berdasarkan katalog layanan dan varian yang dipilih, dan ditampilkan sebelum kamu membayar.</li>
          <li>Kamu bertanggung jawab memastikan alamat, jadwal, dan catatan pesanan sudah benar.</li>
          <li>Bila di lokasi ditemukan kebutuhan tambahan, teknisi akan mengonfirmasi lebih dulu sebelum mengerjakan tambahan tersebut.</li>
          <li>Pesanan dapat dilacak memakai kode booking tanpa perlu login.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="pembayaran" title="5. Pembayaran, saldo, dan komisi">
        <LegalList>
          <li>Pembayaran dilakukan melalui metode yang tersedia, misalnya transfer bank atau bayar di tempat (COD). Bukti pembayaran dapat diunggah dan diverifikasi admin.</li>
          <li>Setiap pesanan yang selesai dikenakan <strong>biaya aplikasi sebesar {formatRupiah(APP_FEE)}</strong> yang dibebankan kepada teknisi, di samping komisi sesuai ketentuan akun teknisi.</li>
          <li>Potongan diambil dari saldo teknisi dan tidak boleh membuat saldo menjadi negatif; sisa yang tidak tertagih bukan utang pribadi kepada Fixify.</li>
          <li>Teknisi dapat menyetor saldo dan mengajukan penarikan sesuai alur yang tersedia, dengan persetujuan admin.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="pembatalan" title="6. Pembatalan dan pengembalian dana">
        <LegalList>
          <li>Pelanggan dapat membatalkan pesanan sebelum teknisi mulai mengerjakan; biaya yang sudah dibayarkan dapat dikembalikan sesuai kebijakan yang berlaku.</li>
          <li>Bila pesanan tidak dapat dilanjutkan karena alasan dari teknisi, kami akan membantu penjadwalan ulang atau pengembalian dana.</li>
          <li>Permintaan pengembalian dana diajukan melalui kontak dukungan dan akan ditinjau berdasarkan bukti yang ada.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="penilaian" title="7. Penilaian dan voucher">
        <LegalList>
          <li>Pelanggan dapat memberi penilaian setelah pesanan selesai. Penilaian harus jujur dan tidak memuat ujaran kebencian, ancaman, atau konten terlarang.</li>
          <li>Setiap penilaian baru berhak atas voucher insentif sebesar <strong>{formatRupiah(REVIEW_INCENTIVE_AMOUNT)}</strong>, satu kali per pesanan.</li>
          <li>Voucher memiliki masa berlaku dan syarat pemakaian yang ditampilkan saat diterima.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="kewajiban" title="8. Kewajiban pelanggan dan teknisi">
        <p><strong>Pelanggan:</strong></p>
        <LegalList>
          <li>memberikan alamat dan catatan yang akurat serta menyediakan akses yang wajar ke lokasi pekerjaan;</li>
          <li>memperlakukan teknisi dengan hormat dan tidak meminta pekerjaan di luar kesepakatan;</li>
          <li>membayar sesuai harga yang telah disepakati.</li>
        </LegalList>
        <p><strong>Teknisi:</strong></p>
        <LegalList>
          <li>memberikan data dan keahlian yang benar serta menjaga kualitas pekerjaan sesuai standar;</li>
          <li>mematuhi jadwal yang disepakati dan berkomunikasi bila ada perubahan;</li>
          <li>menjaga kerahasiaan dan keamanan properti pelanggan di lokasi kerja.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="konten" title="9. Konten pengguna">
        <p>
          Kamu tetap memiliki konten yang kamu unggah (foto, ulasan, laporan). Dengan mengunggahnya,
          kamu memberi Fixify izin untuk menampilkan dan memprosesnya sebatas keperluan layanan. Kamu
          bertanggung jawab memastikan kontenmu tidak melanggar hak pihak lain.
        </p>
      </LegalSection>

      <LegalSection id="larangan" title="10. Larangan">
        <LegalList>
          <li>Menggunakan Fixify untuk kegiatan melanggar hukum atau menyesatkan.</li>
          <li>Mengakses data pengguna lain tanpa izin atau mencoba menembus sistem keamanan.</li>
          <li>Menyalahgunakan voucher, penilaian, atau mekanisme saldo dan komisi.</li>
          <li>Menyalahgunakan identitas atau mendaftar sebagai teknisi dengan data palsu.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="ki" title="11. Hak kekayaan intelektual">
        <p>
          Nama, logo, dan perangkat lunak Fixify dilindungi hukum yang berlaku. Kamu tidak boleh
          menyalin, memodifikasi, atau memakainya tanpa izin tertulis.
        </p>
      </LegalSection>

      <LegalSection id="tanggung-jawab" title="12. Penafian dan batasan tanggung jawab">
        <p>
          Fixify menyediakan platform apa adanya. Sejauh diizinkan hukum, Fixify tidak bertanggung
          jawab atas kerugian tidak langsung yang timbul dari pekerjaan yang dilakukan teknisi, namun
          akan membantu menengahi sengketa yang dilaporkan melalui jalur dukungan.
        </p>
      </LegalSection>

      <LegalSection id="penutupan" title="13. Penangguhan dan penutupan akun">
        <p>
          Kami dapat menangguhkan atau menutup akun yang melanggar ketentuan ini atau membahayakan
          pengguna lain. Kamu dapat menutup akunmu sendiri dengan menghubungi dukungan.
        </p>
      </LegalSection>

      <LegalSection id="hukum" title="14. Perubahan dan hukum yang berlaku">
        <p>
          Kami dapat memperbarui syarat ini; perubahan penting akan diberitahukan lewat aplikasi atau
          email. Syarat ini tunduk pada hukum yang berlaku di Republik Indonesia. Sengketa diupayakan
          diselesaikan secara musyawarah terlebih dahulu.
        </p>
      </LegalSection>

      <LegalSection id="kontak" title="15. Hubungi kami">
        <p>
          Pertanyaan tentang syarat ini dapat disampaikan ke{" "}
          <a href={`mailto:${KONTAK_EMAIL}`} className="text-brand underline">
            {KONTAK_EMAIL}
          </a>
          . Lihat juga{" "}
          <Link href="/privasi" className="text-brand underline">
            Kebijakan Privasi
          </Link>{" "}
          dan{" "}
          <Link href="/panduan-pelanggan" className="text-brand underline">
            Panduan Pelanggan
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
