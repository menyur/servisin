import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";

export const metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Servisin — Platform Pemesanan Jasa Serba Bisa",
  description: "Booking service AC, tukang rumah, dan service kendaraan dalam hitungan menit.",
  openGraph: {
    type: "website",
    siteName: "Servisin",
    locale: "id_ID",
  },
};

// Warna address bar browser mobile + theme PWA (viewport export, Next 14+)
export const viewport = {
  themeColor: "#1C86C7",
};

export default async function RootLayout({ children }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  let pendingTechnicians = 0;
  let pendingBookings = 0;
  let openReports = 0;
  if (user) {
    const { data } = await supabase.from("profiles").select("name, role, avatar_url").eq("id", user.id).single();
    profile = data;

    // badge admin (pendaftar teknisi & booking menunggu) — hanya dihitung untuk admin
    if (profile?.role === "admin") {
      const [{ count: techCount }, { count: bookingCount }, { count: reportCount }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "technician")
          .eq("approval_status", "pending"),
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("reports")
          .select("id", { count: "exact", head: true })
          .eq("status", "open"),
      ]);
      pendingTechnicians = techCount || 0;
      pendingBookings = bookingCount || 0;
      openReports = reportCount || 0;
    }
  }

  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body min-h-screen flex flex-col">
        <Navbar user={user} profile={profile} pendingTechnicians={pendingTechnicians} pendingBookings={pendingBookings} openReports={openReports} />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
