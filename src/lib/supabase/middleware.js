import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

/**
 * Halaman yang hanya masuk akal untuk pengguna yang PUNYA baris `profiles`.
 *
 * Kenapa perlu daftar ini: seluruh halaman di bawahnya membaca peran dari
 * `profiles` (pelanggan/teknisi/admin) dan menampilkan nama dari sana. Sesi yang
 * baris profilnya tidak ada membuat semuanya jatuh ke nilai cadangan — di web
 * "Pelanggan", di aplikasi "Kawan" — dan gerbang peran (teknisi/admin) mati
 * tanpa satu pun galat. Halaman publik (beranda, /track, /hapus-akun, /unduh,
 * /login, /register, halaman hukum) sengaja TIDAK termasuk: pengunjung tanpa
 * akun tidak boleh dipaksa punya profil.
 */
const AWALAN_WAJIB_PROFIL = ["/dashboard", "/technician", "/admin", "/profile", "/booking"];

/** Apakah path ini menuntut pengguna berprofil? Murni (bisa diuji tanpa request). */
export function perluProfil(pathname) {
  const jalur = String(pathname || "");
  return AWALAN_WAJIB_PROFIL.some((a) => jalur === a || jalur.startsWith(`${a}/`));
}

export async function updateSession(request) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Ini yang me-refresh token sesi user di setiap request.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sesi yang baris profilnya tidak ada = sesi tidak sah.
  //
  // Yang ditindak hanya keadaan yang PASTI: barisnya benar-benar tidak ada.
  // Galat baca (jaringan/kueri) SENGAJA tidak menendang pengguna — kegagalan
  // membaca bukan bukti bahwa profilnya hilang, dan menendang orang yang sah
  // karena gangguan sesaat jauh lebih merugikan daripada membiarkannya lewat.
  if (user && perluProfil(request.nextUrl.pathname)) {
    const { data: profil, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!error && !profil) {
      // Sesi dibuang, bukan hanya dialihkan: tanpa itu pengguna berputar
      // antara /login → halaman tujuan → /login tanpa pernah bisa masuk.
      await supabase.auth.signOut();

      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?alasan=profil-tidak-ada";
      const alihan = NextResponse.redirect(url);
      // Cookie hasil signOut ikut dibawa — kalau tidak, sesi lamanya tetap hidup
      // di peramban dan penjagaan ini tidak ada gunanya.
      supabaseResponse.cookies.getAll().forEach((kue) => alihan.cookies.set(kue));
      return alihan;
    }
  }

  return supabaseResponse;
}
