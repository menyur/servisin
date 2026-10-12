import Link from "next/link";
import LegalPage, { LegalSection, LegalList } from "@/components/LegalPage";

export const metadata = {
  title: "Kebijakan Privasi — Fixify",
  description:
    "Bagaimana Fixify mengumpulkan, memakai, membagikan, dan melindungi data pribadi kamu — termasuk data dari Login dengan Google.",
  alternates: { canonical: "/privasi" },
};

// Kontak privasi — samakan dengan kanal dukungan yang dipakai di halaman lain.
const KONTAK_EMAIL = "halo@fixify.id";
const BERLAKU = "12 Oktober 2026";

export default function KebijakanPrivasiPage() {
  return (
    <LegalPage
      eyebrow="Dokumen legal"
      title="Kebijakan Privasi"
      updatedAt={BERLAKU}
      intro={
        <>
          Fixify menghubungkan kamu dengan teknisi terpercaya untuk berbagai kebutuhan rumah dan
          kendaraan. Untuk menjalankan layanan itu kami memproses sejumlah data pribadi. Kebijakan ini
          menjelaskan data apa yang kami kumpulkan, kenapa, bagaimana kami menjaganya, dan apa hakmu.
          Dengan menggunakan layanan Fixify, kamu menyetujui praktik yang dijelaskan di sini.
        </>
      }
    >
      <LegalSection id="data" title="1. Data yang kami kumpulkan">
        <LegalList>
          <li>
            <strong>Data akun.</strong> Nama, alamat email, nomor telepon, dan foto profil yang kamu
            berikan saat mendaftar atau melengkapi profil.
          </li>
          <li>
            <strong>Data Login dengan Google.</strong> Bila kamu masuk memakai akun Google, kami
            menerima nama, alamat email, dan foto profil dari Google. Kami tidak menerima kata sandi
            Google-mu. Lihat bagian 4 di bawah.
          </li>
          <li>
            <strong>Data pesanan.</strong> Layanan yang dipesan, jadwal, alamat dan catatan yang kamu
            tulis, lampiran/bukti pembayaran, serta titik lokasi (garis lintang dan garis bujur) bila
            kamu menandainya di peta saat memesan.
          </li>
          <li>
            <strong>Data teknisi.</strong> Bila kamu mendaftar sebagai teknisi: dokumen identitas
            (KTP), keahlian, area layanan, lokasi saat bertugas, serta informasi rekening untuk
            setoran/penarikan saldo.
          </li>
          <li>
            <strong>Data komunikasi.</strong> Pesan dalam percakapan per pesanan, laporan yang kamu
            kirim, dan penilaian (rating maupun ulasan) yang kamu berikan.
          </li>
          <li>
            <strong>Data teknis.</strong> Token perangkat dan langganan notifikasi (web push serta
            Firebase Cloud Messaging) agar kamu menerima pemberitahuan status pesanan, dan catatan
            teknis dasar untuk menjaga layanan tetap aman dan berjalan.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="tujuan" title="2. Kenapa kami memproses data">
        <LegalList>
          <li>Menyediakan layanan: membuat dan mengelola pesanan, menugaskan teknisi, memproses pembayaran, dan mengirim struk.</li>
          <li>Mengirim notifikasi penting: perubahan status pesanan, pesan, dan pengingat.</li>
          <li>Menjaga keamanan dan mencegah penyalahgunaan: verifikasi identitas teknisi, pencegahan penipuan, dan penegakan aturan.</li>
          <li>Menghitung komisi, saldo, dan biaya aplikasi bagi teknisi.</li>
          <li>Meningkatkan kualitas: menampilkan penilaian teknisi dan menanggapi laporan.</li>
        </LegalList>
        <p>
          Kami memproses data sebatas yang diperlukan untuk tujuan di atas (prinsip minimalisasi data)
          dan tidak menjual data pribadimu kepada pihak lain.
        </p>
      </LegalSection>

      <LegalSection id="google" title="3. Login dengan Google dan data Google">
        <p>
          Aplikasi Android Fixify menyediakan <strong>Masuk dengan Google</strong> melalui Supabase Auth.
          Saat kamu memakainya, kami meminta akses <em>hanya</em> ke data dasar identitas:
        </p>
        <LegalList>
          <li><code>openid</code> — untuk memverifikasi bahwa kamu pemilik akun Google tersebut;</li>
          <li><code>email</code> — alamat email sebagai identitas akun Fixify-mu;</li>
          <li><code>profile</code> — nama tampilan dan foto profil yang ditampilkan di akunmu.</li>
        </LegalList>
        <p>
          Kami memakai data tersebut <strong>hanya untuk membuat dan mengautentikasi akunmu serta
          menampilkan identitasmu di dalam aplikasi</strong>. Kami tidak memakainya untuk iklan, tidak
          menjualnya, dan tidak mengalihkannya ke pihak lain kecuali untuk menjalankan layanan yang
          kamu minta.
        </p>
        <p className="rounded-xl bg-brand-tint px-4 py-3 text-brand-deep">
          Penggunaan informasi yang diterima dari Google API oleh Fixify mematuhi{" "}
          <strong>Google API Services User Data Policy</strong>, termasuk{" "}
          <strong>persyaratan Penggunaan Terbatas (Limited Use)</strong>. Kamu dapat mencabut akses
          kapan saja lewat{" "}
          <a
            href="https://myaccount.google.com/permissions"
            className="underline"
            rel="noreferrer noopener"
            target="_blank"
          >
            setelan akun Google
          </a>{" "}
          atau dengan menghapus akun Fixify-mu (lihat bagian 8).
        </p>
      </LegalSection>

      <LegalSection id="pihak-ketiga" title="4. Berbagi data dengan pihak ketiga">
        <p>
          Kami tidak menjual data pribadi. Kami hanya membagikannya kepada penyedia layanan yang
          membantu menjalankan Fixify, sebatas yang diperlukan:
        </p>
        <LegalList>
          <li><strong>Supabase</strong> — penyimpanan database, autentikasi, dan berkas (foto/bukti/dokumen).</li>
          <li><strong>Vercel</strong> — hosting situs web dan pemrosesan permintaan.</li>
          <li><strong>Google</strong> — Login dengan Google dan Firebase Cloud Messaging (notifikasi ke aplikasi Android).</li>
          <li><strong>Resend</strong> — pengiriman email transaksional (mis. notifikasi pesanan dan verifikasi).</li>
          <li><strong>Midtrans</strong> — pemrosesan pembayaran, bila kamu memilih metode pembayaran daring.</li>
        </LegalList>
        <p>
          Kami juga dapat mengungkap data bila diwajibkan oleh hukum yang berlaku atau untuk melindungi
          hak, keamanan, dan properti Fixify maupun penggunanya.
        </p>
      </LegalSection>

      <LegalSection id="retensi" title="5. Penyimpanan dan retensi">
        <p>
          Riwayat percakapan dan laporan dibersihkan otomatis <strong>30 hari setelah pesanan
          selesai</strong>. Baris pesanan tetap kami simpan sebagai catatan audit (tanpa menampilkannya
          lagi di daftar riwayatmu), sedangkan <strong>catatan keuangan seperti saldo, komisi, penilaian,
          dan voucher tidak dihapus</strong> agar pembukuan tetap utuh. Data akun disimpan selama akunmu
          aktif; bila kamu menghapus akun, data pribadi dihapus atau dianonimkan sesuai ketentuan yang
          berlaku.
        </p>
        <p>
          Rincian aturan retensi ada di{" "}
          <Link href="/syarat" className="text-brand underline">
            Syarat dan Ketentuan
          </Link>{" "}
          serta dokumentasi kebijakan kami.
        </p>
      </LegalSection>

      <LegalSection id="keamanan" title="6. Keamanan data">
        <LegalList>
          <li>Akses data dibatasi di tingkat database dengan Row Level Security, sehingga kamu hanya bisa membaca datamu (dan admin berwenang untuk keperluan operasional).</li>
          <li>Berkas sensitif (bukti pembayaran, dokumen identitas, lampiran laporan) disimpan di penyimpanan <strong>privat</strong>, tidak dapat diakses publik.</li>
          <li>Seluruh lalu lintas data dienkripsi lewat HTTPS.</li>
          <li>Kredensial server disimpan sebagai variabel rahasia dan tidak pernah dibundel ke aplikasi.</li>
        </LegalList>
        <p>
          Meski kami berupaya maksimal, tidak ada sistem yang sepenuhnya bebas risiko. Kami menyarankan
          kamu menjaga kerahasiaan kata sandi dan tidak membagikan akses akunmu.
        </p>
      </LegalSection>

      <LegalSection id="hak" title="7. Hak kamu atas data">
        <p>Kamu berhak untuk:</p>
        <LegalList>
          <li>meminta salinan dan mengakses data pribadimu yang kami simpan;</li>
          <li>memperbaiki data yang tidak akurat (nama, nomor telepon, dan foto profil dapat diubah sendiri dari halaman profil);</li>
          <li>meminta penghapusan akun dan data pribadi yang tidak wajib kami simpan;</li>
          <li>menarik persetujuan, misalnya mematikan notifikasi atau mencabut akses Login dengan Google.</li>
        </LegalList>
        <p>
          Untuk mengajukan permintaan tersebut, hubungi kami di{" "}
          <a href={`mailto:${KONTAK_EMAIL}`} className="text-brand underline">
            {KONTAK_EMAIL}
          </a>
          . Kami akan menindaklanjuti dalam waktu yang wajar.
        </p>
      </LegalSection>

      <LegalSection id="cookie" title="8. Cookie dan penyimpanan lokal">
        <p>
          Kami memakai cookie dan penyimpanan lokal yang diperlukan agar kamu tetap masuk (sesi) dan
          agar aplikasi berjalan. Kami tidak memakai cookie untuk pelacakan iklan pihak ketiga.
        </p>
      </LegalSection>

      <LegalSection id="anak" title="9. Anak di bawah umur">
        <p>
          Fixify ditujukan untuk pengguna berusia minimal 18 tahun. Kami tidak dengan sengaja
          mengumpulkan data anak di bawah umur. Bila kamu mengetahui adanya data seperti itu, hubungi
          kami untuk kami hapus.
        </p>
      </LegalSection>

      <LegalSection id="perubahan" title="10. Perubahan kebijakan">
        <p>
          Kami dapat memperbarui kebijakan ini sewaktu-waktu. Perubahan penting akan kami beritahukan
          melalui aplikasi atau email. Tanggal berlaku terbaru selalu ditampilkan di bagian atas
          halaman ini.
        </p>
      </LegalSection>

      <LegalSection id="kontak" title="11. Hubungi kami">
        <p>
          Pertanyaan tentang privasi atau permintaan terkait data dapat disampaikan ke{" "}
          <a href={`mailto:${KONTAK_EMAIL}`} className="text-brand underline">
            {KONTAK_EMAIL}
          </a>
          . Lihat juga{" "}
          <Link href="/syarat" className="text-brand underline">
            Syarat dan Ketentuan
          </Link>{" "}
          dan{" "}
          <Link href="/tentang" className="text-brand underline">
            Tentang Kami
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
