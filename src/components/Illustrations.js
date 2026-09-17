// Ilustrasi SVG orisinal (bukan foto), memakai palet warna brand Servisin.
// Dipakai di hero landing page, thumbnail kartu layanan, halaman auth, empty-state, dll.

const COLORS = {
  navy: "#0B3556",
  brand: "#1C86C7",
  brandDeep: "#135F94",
  sky: "#6FC3E8",
  skyTint: "#EAF6FC",
  mint: "#2C8F63",
  mintTint: "#E4F5EC",
  amber: "#C97F16",
  amberTint: "#FBEEDA",
  coral: "#C3492F",
  coralTint: "#FBEAE5",
  line: "#D7E7F0",
};

/* ---------------------------------- HERO ---------------------------------- */

/** Ilustrasi besar untuk hero: rumah dengan teknisi, AC, tukang, dan kendaraan mengelilinginya. */
export function HeroIllustration(props) {
  return (
    <svg viewBox="0 0 520 420" width="100%" role="img" aria-label="Ilustrasi teknisi memperbaiki rumah dikelilingi layanan AC, tukang, dan kendaraan" {...props}>
      <defs>
        <linearGradient id="heroSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor={COLORS.skyTint} />
        </linearGradient>
        <linearGradient id="heroGround" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={COLORS.line} />
          <stop offset="100%" stopColor={COLORS.skyTint} />
        </linearGradient>
      </defs>

      {/* langit & tanah */}
      <ellipse cx="260" cy="210" rx="235" ry="185" fill="url(#heroSky)" />
      <path d="M40 330 Q260 310 480 330 L480 345 Q260 368 40 345 Z" fill="url(#heroGround)" />
      <ellipse cx="260" cy="337" rx="220" ry="18" fill={COLORS.line} opacity="0.5" />

      {/* awan */}
      <g fill="#FFFFFF" opacity="0.9">
        <ellipse cx="98" cy="72" rx="30" ry="14" />
        <ellipse cx="118" cy="62" rx="22" ry="12" />
        <ellipse cx="432" cy="110" rx="26" ry="12" />
        <ellipse cx="450" cy="102" rx="16" ry="9" />
      </g>
      <circle cx="452" cy="52" r="20" fill={COLORS.amberTint} stroke={COLORS.amber} strokeWidth="3" />
      <g stroke={COLORS.amber} strokeWidth="3" strokeLinecap="round">
        <path d="M452 22 v-8 M452 90 v8 M422 52 h-8 M490 52 h-8 M431 31 l-6 -6 M478 78 l6 6 M431 73 l-6 6 M478 26 l6 -6" opacity="0" />
      </g>

      {/* bayangan dekoratif */}
      <circle cx="78" cy="150" r="30" fill={COLORS.mintTint} opacity="0.8" />
      <circle cx="470" cy="270" r="22" fill={COLORS.amberTint} opacity="0.9" />
      <circle cx="60" cy="262" r="14" fill={COLORS.coralTint} opacity="0.9" />

      {/* pohon kiri */}
      <g>
        <rect x="66" y="252" width="10" height="62" rx="4" fill={COLORS.brandDeep} />
        <circle cx="71" cy="238" r="28" fill={COLORS.mint} />
        <circle cx="52" cy="252" r="16" fill={COLORS.mint} opacity="0.8" />
        <circle cx="90" cy="252" r="15" fill={COLORS.mint} opacity="0.8" />
      </g>

      {/* semak kanan */}
      <g>
        <circle cx="446" cy="308" r="14" fill={COLORS.mint} opacity="0.85" />
        <circle cx="462" cy="312" r="10" fill={COLORS.mint} opacity="0.7" />
      </g>

      {/* rumah di tengah */}
      <g transform="translate(178,118)">
        {/* bayangan rumah */}
        <ellipse cx="70" cy="150" rx="92" ry="12" fill={COLORS.navy} opacity="0.08" />
        <rect x="0" y="52" width="140" height="98" rx="8" fill="#ffffff" stroke={COLORS.line} strokeWidth="2" />
        <path d="M -12 62 L 70 2 L 152 62 Z" fill={COLORS.navy} />
        <path d="M -12 62 L 70 2 L 152 62" fill="none" stroke={COLORS.brandDeep} strokeWidth="3" strokeLinejoin="round" />
        {/* jendela atap */}
        <circle cx="70" cy="38" r="11" fill={COLORS.skyTint} stroke={COLORS.brandDeep} strokeWidth="3" />
        <path d="M70 27 v22 M59 38 h22" stroke={COLORS.brandDeep} strokeWidth="1.6" />
        {/* cerobong + asap */}
        <rect x="108" y="16" width="14" height="30" rx="3" fill={COLORS.brandDeep} />
        <g fill={COLORS.sky} opacity="0.6">
          <circle cx="119" cy="8" r="5" />
          <circle cx="126" cy="-2" r="6.5" />
          <circle cx="135" cy="-14" r="8" />
        </g>
        {/* pintu */}
        <rect x="58" y="92" width="26" height="58" rx="3" fill={COLORS.brand} />
        <circle cx="78" cy="122" r="2.4" fill="#ffffff" />
        {/* jendela */}
        <rect x="16" y="76" width="28" height="26" rx="3" fill={COLORS.skyTint} stroke={COLORS.brand} strokeWidth="2.5" />
        <path d="M30 76 v26 M16 89 h28" stroke={COLORS.brand} strokeWidth="1.6" />
        <rect x="96" y="76" width="28" height="26" rx="3" fill={COLORS.skyTint} stroke={COLORS.brand} strokeWidth="2.5" />
        <path d="M110 76 v26 M96 89 h28" stroke={COLORS.brand} strokeWidth="1.6" />
        {/* tanaman pot di depan */}
        <g transform="translate(120,124)">
          <path d="M0 14 h18 l-3 12 h-12 Z" fill={COLORS.coral} />
          <path d="M9 12 C 9 2, 2 0, 0 -4 M9 12 C 9 4, 16 2, 18 -2 M9 12 v-14" stroke={COLORS.mint} strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
        {/* lampu gantung */}
        <g transform="translate(34,124)">
          <path d="M0 0 v10" stroke={COLORS.navy} strokeWidth="2" />
          <circle cx="0" cy="15" r="5" fill={COLORS.amber} />
          <circle cx="0" cy="15" r="2" fill={COLORS.amberTint} />
        </g>
      </g>

      {/* unit AC di atas rumah, kiri */}
      <g transform="translate(72,52)">
        <circle cx="36" cy="12" r="34" fill="#ffffff" opacity="0.85" />
        <rect x="0" y="0" width="72" height="24" rx="6" fill={COLORS.navy} />
        <rect x="6" y="5" width="60" height="6" rx="3" fill={COLORS.sky} />
        <circle cx="62" cy="17" r="2" fill={COLORS.mint} />
        <path d="M12 26 C12 46, -4 54, -4 74" stroke={COLORS.sky} strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d="M36 26 C36 50, 20 58, 20 82" stroke={COLORS.sky} strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.75" />
        <path d="M58 26 C58 46, 70 54, 70 70" stroke={COLORS.sky} strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.55" />
      </g>

      {/* teknisi perbaiki AC, melayang kiri */}
      <g transform="translate(28,110)">
        <circle cx="40" cy="46" r="40" fill={COLORS.mintTint} />
        {/* tangan memegang obeng ke AC */}
        <path d="M62 30 C 74 24, 84 20, 92 18" stroke={COLORS.brandDeep} strokeWidth="7" strokeLinecap="round" fill="none" />
        <rect x="90" y="10" width="14" height="5" rx="2.5" transform="rotate(-10 97 12)" fill={COLORS.amber} />
        {/* kepala */}
        <circle cx="46" cy="22" r="13" fill="#F5C9A1" />
        <path d="M33 20 a13 13 0 0 1 26 0 v-4 a13 8 0 0 0 -26 0 Z" fill={COLORS.navy} />
        <rect x="30" y="8" width="32" height="10" rx="5" fill={COLORS.amber} />
        {/* badan overall */}
        <rect x="32" y="34" width="28" height="38" rx="10" fill={COLORS.brand} />
        <rect x="42" y="34" width="8" height="16" fill={COLORS.brandDeep} />
        {/* kaki */}
        <rect x="34" y="70" width="9" height="22" rx="4" fill={COLORS.navy} />
        <rect x="49" y="70" width="9" height="22" rx="4" fill={COLORS.navy} />
        <rect x="31" y="90" width="14" height="6" rx="3" fill={COLORS.navy} />
        <rect x="47" y="90" width="14" height="6" rx="3" fill={COLORS.navy} />
        {/* kotak peralatan */}
        <rect x="12" y="76" width="20" height="14" rx="2" fill={COLORS.amber} />
        <path d="M18 76 v-4 h8 v4" fill="none" stroke={COLORS.amber} strokeWidth="3" />
      </g>

      {/* ikon kunci pas / tukang, kanan atas */}
      <g transform="translate(352,58)">
        <circle cx="32" cy="32" r="38" fill="#ffffff" stroke={COLORS.amberTint} strokeWidth="9" />
        <g transform="rotate(40 32 32)">
          <rect x="28.5" y="14" width="7" height="26" rx="3.5" fill={COLORS.amber} />
          <circle cx="32" cy="18" r="9" fill="none" stroke={COLORS.amber} strokeWidth="5" />
          <rect x="24" y="38" width="16" height="7" rx="3.5" fill={COLORS.amber} />
          <circle cx="24" cy="45" r="5.5" fill="none" stroke={COLORS.amber} strokeWidth="4" />
          <circle cx="40" cy="45" r="5.5" fill="none" stroke={COLORS.amber} strokeWidth="4" />
        </g>
        {/* kilau */}
        <g stroke={COLORS.amber} strokeWidth="2.5" strokeLinecap="round">
          <path d="M10 12 l4 4 M58 10 l-4 4 M60 52 l-4 -4" />
        </g>
      </g>

      {/* mobil kecil, kanan bawah */}
      <g transform="translate(318,282)">
        <ellipse cx="42" cy="48" rx="48" ry="8" fill={COLORS.navy} opacity="0.1" />
        <rect x="0" y="14" width="86" height="26" rx="9" fill={COLORS.mint} />
        <path d="M10 14 L26 -4 L60 -4 L76 14 Z" fill={COLORS.mint} opacity="0.9" />
        <rect x="28" y="0" width="28" height="15" rx="2" fill={COLORS.skyTint} />
        <rect x="43" y="0" width="3" height="15" fill={COLORS.mint} />
        <circle cx="20" cy="42" r="9" fill={COLORS.navy} />
        <circle cx="20" cy="42" r="4" fill="#ffffff" />
        <circle cx="66" cy="42" r="9" fill={COLORS.navy} />
        <circle cx="66" cy="42" r="4" fill="#ffffff" />
        {/* lampu depan + sinar */}
        <circle cx="84" cy="22" r="3" fill={COLORS.amberTint} />
        <path d="M88 16 L104 10 M88 22 L106 22 M88 28 L104 34" stroke={COLORS.amber} strokeWidth="2.5" strokeLinecap="round" />
      </g>

      {/* notifikasi chat */}
      <g transform="translate(238,42)">
        <rect x="0" y="0" width="52" height="34" rx="10" fill="#ffffff" stroke={COLORS.line} strokeWidth="2" />
        <path d="M14 34 L18 42 L26 34 Z" fill="#ffffff" stroke={COLORS.line} strokeWidth="2" strokeLinejoin="round" />
        <path d="M14 34 L18 42 L26 34" fill="#ffffff" />
        <circle cx="15" cy="17" r="3" fill={COLORS.brand} />
        <circle cx="26" cy="17" r="3" fill={COLORS.sky} />
        <circle cx="37" cy="17" r="3" fill={COLORS.mint} />
      </g>

      {/* garis putus-putus penghubung */}
      <path d="M172 160 C130 140, 112 110, 104 90" stroke={COLORS.brand} strokeWidth="2" strokeDasharray="4 5" fill="none" opacity="0.5" />
      <path d="M320 160 C340 128, 352 108, 356 96" stroke={COLORS.amber} strokeWidth="2" strokeDasharray="4 5" fill="none" opacity="0.5" />
      <path d="M310 226 C330 248, 336 260, 340 274" stroke={COLORS.mint} strokeWidth="2" strokeDasharray="4 5" fill="none" opacity="0.5" />
    </svg>
  );
}

/* ----------------------------- AVATAR TIM -------------------------------- */

/** Avatar ilustrasi: pendiri & teknisi (lengan, helm amber, senyum ramah). */
export function AvatarRaka(props) {
  return (
    <svg viewBox="0 0 120 120" width="100%" role="img" aria-label="Avatar ilustrasi Raka, pendiri Servisin" {...props}>
      <circle cx="60" cy="60" r="56" fill={COLORS.skyTint} />
      <circle cx="60" cy="60" r="46" fill="#ffffff" opacity="0.6" />
      <g transform="translate(60,64)">
        <path d="M-30 44 a30 26 0 0 1 60 0 Z" fill={COLORS.brand} />
        <path d="M-30 44 a30 26 0 0 1 60 0" fill="none" stroke={COLORS.brandDeep} strokeWidth="2" opacity="0.5" />
        <rect x="-6" y="14" width="12" height="12" rx="3" fill={COLORS.brandDeep} />
        <circle cx="0" cy="-14" r="20" fill="#F5C9A1" />
        <path d="M-20 -15 a20 20 0 0 1 40 0 v-5 a20 13 0 0 0 -40 0 Z" fill={COLORS.navy} />
        <rect x="-17" y="-32" width="34" height="11" rx="5.5" fill={COLORS.amber} />
        <rect x="-24" y="-24" width="48" height="5" rx="2.5" fill={COLORS.amber} opacity="0.9" />
        <path d="M-9 -6 a9 9 0 0 0 18 0" stroke={COLORS.navy} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="-8" cy="-13" r="2.2" fill={COLORS.navy} />
        <circle cx="8" cy="-13" r="2.2" fill={COLORS.navy} />
      </g>
      <path d="M18 30 l4 8 8 4 -8 4 -4 8 -4 -8 -8 -4 8 -4 Z" fill={COLORS.amber} opacity="0.85" transform="scale(0.7) translate(8,12)" />
    </svg>
  );
}

/** Avatar ilustrasi: co-founder & operasional (bukti rambut, kacamata, blazer mint). */
export function AvatarSari(props) {
  return (
    <svg viewBox="0 0 120 120" width="100%" role="img" aria-label="Avatar ilustrasi Sari, co-founder & kepala operasional" {...props}>
      <circle cx="60" cy="60" r="56" fill={COLORS.mintTint} />
      <circle cx="60" cy="60" r="46" fill="#ffffff" opacity="0.6" />
      <g transform="translate(60,64)">
        <path d="M-30 44 a30 26 0 0 1 60 0 Z" fill={COLORS.mint} />
        <rect x="-7" y="14" width="14" height="12" rx="3" fill={COLORS.navy} opacity="0.85" />
        <circle cx="0" cy="-14" r="20" fill="#F5C9A1" />
        <path d="M-22 -8 C -24 -30, -8 -38, 0 -34 C 12 -38, 24 -28, 22 -8 C 18 -22, 8 -28, 0 -26 C -10 -28, -18 -22, -22 -8 Z" fill={COLORS.navy} />
        <circle cx="-9" cy="-12" r="6.5" fill="none" stroke={COLORS.navy} strokeWidth="2.2" />
        <circle cx="9" cy="-12" r="6.5" fill="none" stroke={COLORS.navy} strokeWidth="2.2" />
        <path d="M-2.5 -12 h5" stroke={COLORS.navy} strokeWidth="2.2" />
        <path d="M-7 -3 a7 7 0 0 0 14 0" stroke={COLORS.navy} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="-7" cy="-6" r="1.8" fill={COLORS.coral} opacity="0.7" />
        <circle cx="7" cy="-6" r="1.8" fill={COLORS.coral} opacity="0.7" />
      </g>
      <circle cx="98" cy="30" r="6" fill={COLORS.brand} opacity="0.5" />
      <circle cx="24" cy="92" r="4" fill={COLORS.amber} opacity="0.6" />
    </svg>
  );
}

/** Avatar ilustrasi: kepala teknisi (helm proyek, kumis, wajah ceria). */
export function AvatarBima(props) {
  return (
    <svg viewBox="0 0 120 120" width="100%" role="img" aria-label="Avatar ilustrasi Bima, kepala teknisi" {...props}>
      <circle cx="60" cy="60" r="56" fill={COLORS.amberTint} />
      <circle cx="60" cy="60" r="46" fill="#ffffff" opacity="0.6" />
      <g transform="translate(60,64)">
        <path d="M-30 44 a30 26 0 0 1 60 0 Z" fill={COLORS.navy} />
        <rect x="-6" y="14" width="12" height="12" rx="3" fill={COLORS.amber} />
        <circle cx="0" cy="-16" r="19" fill="#E8B48A" />
        <path d="M-27 -16 a27 21 0 0 1 54 0 Z" fill={COLORS.amber} />
        <rect x="-31" y="-18" width="62" height="6" rx="3" fill={COLORS.brandDeep} />
        <path d="M-8 -2 a8 8 0 0 0 16 0 v-1 a8 4 0 0 0 -16 0 Z" fill={COLORS.navy} />
        <circle cx="-8" cy="-14" r="2.2" fill={COLORS.navy} />
        <circle cx="8" cy="-14" r="2.2" fill={COLORS.navy} />
        <path d="M-10 -8 q10 6 20 0" stroke={COLORS.navy} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </g>
      <path d="M92 88 l3 6 6 3 -6 3 -3 6 -3 -6 -6 -3 6 -3 Z" fill={COLORS.brand} opacity="0.7" transform="scale(0.8) translate(24,-26)" />
    </svg>
  );
}

/* ------------------------------ MINI TRUST ------------------------------- */

/** Mini ilustrasi: teknisi datang tepat waktu (jam + centang). */
export function TrustFast(props) {
  return (
    <svg viewBox="0 0 96 72" width="100%" role="img" aria-hidden="true" {...props}>
      <circle cx="48" cy="36" r="34" fill={COLORS.skyTint} />
      <circle cx="48" cy="36" r="24" fill="#ffffff" stroke={COLORS.brand} strokeWidth="3.5" />
      <path d="M48 36 V22 M48 36 l10 6" stroke={COLORS.navy} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M48 6 v-4 M48 70 v-2 M78 36 h4 M14 36 h2" stroke={COLORS.brand} strokeWidth="3" strokeLinecap="round" />
      <circle cx="72" cy="16" r="9" fill={COLORS.mint} />
      <path d="M68 16 l3 3 5 -6" stroke="#ffffff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mini ilustrasi: teknisi bersertifikat (orang + lanyard ID). */
export function TrustPro(props) {
  return (
    <svg viewBox="0 0 96 72" width="100%" role="img" aria-hidden="true" {...props}>
      <circle cx="48" cy="36" r="34" fill={COLORS.mintTint} />
      <circle cx="48" cy="24" r="11" fill="#F5C9A1" />
      <path d="M37 23 a11 11 0 0 1 22 0 v-3 a11 7 0 0 0 -22 0 Z" fill={COLORS.navy} />
      <rect x="40" y="13" width="16" height="6" rx="3" fill={COLORS.mint} />
      <path d="M30 58 a18 16 0 0 1 36 0 Z" fill={COLORS.brand} />
      <rect x="45" y="36" width="6" height="9" rx="2" fill={COLORS.amber} />
      <rect x="42" y="44" width="12" height="10" rx="2" fill="#ffffff" stroke={COLORS.navy} strokeWidth="1.6" />
      <circle cx="48" cy="49" r="2.2" fill={COLORS.brand} />
    </svg>
  );
}

/** Mini ilustrasi: harga transparan (tag + koin). */
export function TrustPrice(props) {
  return (
    <svg viewBox="0 0 96 72" width="100%" role="img" aria-hidden="true" {...props}>
      <circle cx="48" cy="36" r="34" fill={COLORS.amberTint} />
      <g transform="rotate(-18 42 38)">
        <path d="M28 30 h28 v18 a4 4 0 0 1 -4 4 H32 a4 4 0 0 1 -4 -4 Z" fill="#ffffff" stroke={COLORS.amber} strokeWidth="3" />
        <circle cx="42" cy="30" r="4" fill={COLORS.amberTint} stroke={COLORS.amber} strokeWidth="2.4" />
        <path d="M36 42 h12 M36 47 h8" stroke={COLORS.amber} strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <circle cx="66" cy="22" r="9" fill={COLORS.amber} />
      <path d="M66 17.5 v9 M63.5 20 h5 M63.5 24 h5" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="24" cy="20" r="3" fill={COLORS.amber} opacity="0.6" />
      <circle cx="72" cy="52" r="4" fill={COLORS.amber} opacity="0.5" />
    </svg>
  );
}

/* ------------------------------ EMPTY STATE ------------------------------ */

/** Ilustrasi empty-state: kotak terbuka dengan daftar kosong & pesawat kertas. */
export function EmptyBoxIllustration(props) {
  return (
    <svg viewBox="0 0 220 140" width="100%" role="img" aria-hidden="true" {...props}>
      <ellipse cx="110" cy="122" rx="82" ry="10" fill={COLORS.line} opacity="0.55" />
      {/* kotak */}
      <path d="M60 70 L110 52 L160 70 L160 112 L110 130 L60 112 Z" fill="#ffffff" stroke={COLORS.line} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M60 70 L110 88 L160 70" fill="none" stroke={COLORS.line} strokeWidth="2.5" />
      <path d="M110 88 V130" stroke={COLORS.line} strokeWidth="2.5" />
      {/* flap kiri terbuka */}
      <path d="M60 70 L38 58 L88 40 L110 52 Z" fill={COLORS.skyTint} stroke={COLORS.line} strokeWidth="2.5" strokeLinejoin="round" />
      {/* daftar terbang keluar */}
      <g transform="rotate(-8 150 40)">
        <rect x="128" y="18" width="46" height="56" rx="5" fill="#ffffff" stroke={COLORS.line} strokeWidth="2.5" />
        <path d="M136 30 h26 M136 40 h30 M136 50 h20 M136 60 h26" stroke={COLORS.sky} strokeWidth="3.5" strokeLinecap="round" />
        <rect x="136" y="66" width="14" height="4" rx="2" fill={COLORS.brand} />
      </g>
      {/* pesawat kertas */}
      <path d="M176 92 l20 -8 -12 14 -2 -5 Z" fill={COLORS.brand} />
      {/* bintang kecil */}
      <g fill={COLORS.amber}>
        <circle cx="36" cy="34" r="3" />
        <circle cx="188" cy="34" r="2.5" opacity="0.7" />
        <circle cx="52" cy="116" r="2.5" opacity="0.7" />
      </g>
    </svg>
  );
}

/* --------------------------------- AUTH ---------------------------------- */

/** Ilustrasi samping untuk halaman login/register: teknisi ramah + kartu. */
export function AuthIllustration(props) {
  return (
    <svg viewBox="0 0 220 180" width="100%" role="img" aria-hidden="true" {...props}>
      <circle cx="110" cy="92" r="76" fill={COLORS.skyTint} />
      <circle cx="42" cy="42" r="10" fill={COLORS.mintTint} />
      <circle cx="180" cy="140" r="8" fill={COLORS.amberTint} />

      {/* teknisi */}
      <g transform="translate(64,44)">
        <circle cx="34" cy="20" r="15" fill="#F5C9A1" />
        <path d="M19 19 a15 15 0 0 1 30 0 v-4 a15 9 0 0 0 -30 0 Z" fill={COLORS.navy} />
        <rect x="22" y="7" width="24" height="9" rx="4.5" fill={COLORS.brand} />
        {/* senyum */}
        <path d="M29 25 a6 6 0 0 0 10 0" stroke={COLORS.navy} strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* badan */}
        <path d="M12 66 a22 22 0 0 1 44 0 Z" fill={COLORS.brand} />
        <rect x="31" y="34" width="6" height="12" rx="2" fill={COLORS.brandDeep} />
      </g>

      {/* kartu ID melayang */}
      <g transform="translate(128,58) rotate(6)">
        <rect x="0" y="0" width="56" height="72" rx="8" fill="#ffffff" stroke={COLORS.line} strokeWidth="2.5" />
        <circle cx="28" cy="24" r="11" fill={COLORS.skyTint} stroke={COLORS.brand} strokeWidth="2" />
        <path d="M23 24 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M15 40 a13 9 0 0 1 26 0" stroke={COLORS.brand} strokeWidth="2" fill="none" />
        <path d="M12 52 h32 M12 59 h20" stroke={COLORS.line} strokeWidth="3" strokeLinecap="round" />
      </g>

      {/* kunci pas kecil */}
      <g transform="translate(30,108) rotate(-20)">
        <rect x="-3" y="-16" width="6" height="24" rx="3" fill={COLORS.amber} />
        <circle cx="0" cy="-18" r="7.5" fill="none" stroke={COLORS.amber} strokeWidth="4.5" />
      </g>

      {/* centang */}
      <g transform="translate(150,130)">
        <circle cx="0" cy="0" r="12" fill={COLORS.mint} />
        <path d="M-5 0 l4 4 7 -8" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/* ------------------------------ THUMBNAILS ------------------------------- */

/** Thumbnail kartu untuk kategori Service AC. */
export function AcThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="acBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F3FBFF" />
          <stop offset="100%" stopColor={COLORS.skyTint} />
        </linearGradient>
      </defs>
      <rect width="200" height="110" fill="url(#acBg)" />
      {/* salju dekoratif */}
      <g fill={COLORS.sky} opacity="0.35">
        <circle cx="24" cy="20" r="3" />
        <circle cx="178" cy="18" r="4" />
        <circle cx="30" cy="88" r="2.5" />
        <circle cx="170" cy="92" r="3" />
        <path d="M150 62 l0 10 M145 67 l10 0 M147 63.5 l6 7 M153 63.5 l-6 7" stroke={COLORS.sky} strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* unit AC */}
      <rect x="48" y="22" width="104" height="30" rx="9" fill={COLORS.navy} />
      <rect x="48" y="22" width="104" height="9" rx="4.5" fill={COLORS.brandDeep} opacity="0.6" />
      <rect x="56" y="30" width="70" height="7" rx="3.5" fill={COLORS.sky} />
      <circle cx="140" cy="34" r="4" fill={COLORS.mint} />
      <circle cx="140" cy="34" r="1.6" fill="#ffffff" />
      {/* aliran dingin */}
      {[0, 1, 2, 3].map((i) => (
        <path
          key={i}
          d={`M${62 + i * 26} 56 C ${62 + i * 26} 74, ${48 + i * 26} 84, ${48 + i * 26} 100`}
          stroke={COLORS.brand}
          strokeWidth="4.5"
          strokeLinecap="round"
          fill="none"
          opacity={0.9 - i * 0.18}
        />
      ))}
      {/* suhu dingin badge */}
      <g transform="translate(158,70)">
        <circle cx="0" cy="0" r="12" fill="#ffffff" stroke={COLORS.brand} strokeWidth="2.5" />
        <path d="M0 -5 v10 M-3.5 -2.5 l7 5 M-3.5 2.5 l7 -5" stroke={COLORS.brand} strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Thumbnail kartu untuk kategori Jasa Tukang Rumah. */
export function TukangThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="tukangBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFDF8" />
          <stop offset="100%" stopColor={COLORS.amberTint} />
        </linearGradient>
      </defs>
      <rect width="200" height="110" fill="url(#tukangBg)" />
      {/* awan dekoratif */}
      <g fill="#ffffff" opacity="0.8">
        <ellipse cx="30" cy="24" rx="16" ry="7" />
        <ellipse cx="176" cy="34" rx="13" ry="6" />
      </g>
      {/* rumah */}
      <path d="M56 66 L100 28 L144 66 Z" fill={COLORS.navy} />
      <path d="M56 66 L100 28 L144 66" fill="none" stroke={COLORS.amber} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="100" cy="48" r="6" fill={COLORS.amberTint} stroke={COLORS.sky} strokeWidth="2.5" />
      <rect x="68" y="66" width="64" height="36" fill="#ffffff" stroke={COLORS.amber} strokeWidth="2.5" />
      <rect x="90" y="80" width="20" height="22" fill={COLORS.amber} />
      <circle cx="106" cy="91" r="1.8" fill="#ffffff" />
      <rect x="76" y="74" width="14" height="12" rx="2" fill={COLORS.skyTint} stroke={COLORS.brand} strokeWidth="2" />
      <rect x="110" y="74" width="14" height="12" rx="2" fill={COLORS.skyTint} stroke={COLORS.brand} strokeWidth="2" />
      {/* palu & kunci pas menyilang */}
      <g transform="translate(158,74) rotate(40)">
        <rect x="-2.5" y="-18" width="5" height="24" rx="2.5" fill={COLORS.amber} />
        <rect x="-8" y="-22" width="16" height="7" rx="3" fill={COLORS.navy} />
      </g>
      {/* sekrup & bor dekoratif */}
      <g stroke={COLORS.amber} strokeWidth="2.5" strokeLinecap="round" opacity="0.7">
        <path d="M26 76 l10 10 M36 76 l-10 10" />
      </g>
      <circle cx="26" cy="24" r="0" />
      <g transform="translate(24,60)">
        <circle cx="0" cy="0" r="4.5" fill="none" stroke={COLORS.amber} strokeWidth="2.5" />
        <path d="M0 -9 v-5" stroke={COLORS.amber} strokeWidth="2.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Thumbnail kartu untuk kategori Service Kendaraan. */
export function KendaraanThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="kendaraanBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F5FCF8" />
          <stop offset="100%" stopColor={COLORS.mintTint} />
        </linearGradient>
      </defs>
      <rect width="200" height="110" fill="url(#kendaraanBg)" />
      {/* garis kecepatan */}
      <path d="M14 52 h18 M10 62 h22 M16 72 h14" stroke={COLORS.mint} strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      {/* mobil */}
      <ellipse cx="108" cy="96" rx="62" ry="7" fill={COLORS.navy} opacity="0.08" />
      <rect x="44" y="52" width="128" height="32" rx="11" fill={COLORS.mint} />
      <path d="M62 52 L82 26 L134 26 L154 52 Z" fill={COLORS.mint} opacity="0.9" />
      <rect x="88" y="32" width="42" height="20" rx="3" fill={COLORS.skyTint} />
      <path d="M108 32 v20" stroke={COLORS.mint} strokeWidth="3" />
      <circle cx="70" cy="86" r="12" fill={COLORS.navy} />
      <circle cx="70" cy="86" r="5" fill="#ffffff" />
      <circle cx="146" cy="86" r="12" fill={COLORS.navy} />
      <circle cx="146" cy="86" r="5" fill="#ffffff" />
      {/* lampu depan */}
      <circle cx="170" cy="60" r="4" fill={COLORS.amberTint} stroke={COLORS.amber} strokeWidth="1.5" />
      <path d="M176 54 l12 -6 M176 60 l14 0 M176 66 l12 6" stroke={COLORS.amber} strokeWidth="2.5" strokeLinecap="round" />
      {/* kunci pas badge */}
      <g transform="translate(36,30)">
        <circle cx="0" cy="0" r="13" fill="#ffffff" stroke={COLORS.mint} strokeWidth="2.5" />
        <g transform="rotate(40)">
          <rect x="-2.5" y="-9" width="5" height="14" rx="2.5" fill={COLORS.mint} />
          <circle cx="0" cy="-9" r="5" fill="none" stroke={COLORS.mint} strokeWidth="3" />
        </g>
      </g>
    </svg>
  );
}

export const CATEGORY_THUMBS = {
  ac: AcThumb,
  tukang: TukangThumb,
  kendaraan: KendaraanThumb,
  kebersihan: KebersihanThumb,
};

export function CategoryThumb({ categoryId, ...props }) {
  const Thumb = CATEGORY_THUMBS[categoryId] || AcThumb;
  return <Thumb {...props} />;
}

/* ------------------------------ HEADER AC -------------------------------- */

/** Header/banner lebar untuk bagian Service AC: teknisi menyemprot AC hingga dingin. */
export function AcHeaderIllustration(props) {
  return (
    <svg viewBox="0 0 900 220" width="100%" role="img" aria-label="Ilustrasi header Service AC: teknisi membersihkan AC hingga mengeluarkan udara dingin" {...props}>
      <defs>
        <linearGradient id="acHeaderBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F3FBFF" />
          <stop offset="100%" stopColor={COLORS.skyTint} />
        </linearGradient>
      </defs>

      {/* latar */}
      <rect width="900" height="220" rx="24" fill="url(#acHeaderBg)" />
      <circle cx="450" cy="110" r="95" fill="#ffffff" opacity="0.5" />
      <path d="M60 30 C 200 10, 400 16, 560 28" stroke={COLORS.line} strokeWidth="3" strokeDasharray="2 9" fill="none" strokeLinecap="round" opacity="0.9" />
      <path d="M640 36 C 720 30, 790 34, 852 30" stroke={COLORS.line} strokeWidth="3" strokeDasharray="2 9" fill="none" strokeLinecap="round" opacity="0.7" />

      {/* lantai */}
      <rect x="40" y="178" width="820" height="14" rx="7" fill={COLORS.line} opacity="0.5" />

      {/* termometer dingin, kiri */}
      <g>
        <rect x="84" y="78" width="16" height="72" rx="8" fill="#ffffff" stroke={COLORS.navy} strokeWidth="3" />
        <circle cx="92" cy="156" r="13" fill={COLORS.brand} />
        <rect x="89" y="100" width="6" height="50" rx="3" fill={COLORS.brand} />
        <path d="M106 92 h9 M106 108 h9 M106 124 h9" stroke={COLORS.navy} strokeWidth="2" opacity="0.45" strokeLinecap="round" />
        <path d="M64 92 l6 -4 M62 104 l7 0 M64 116 l6 4" stroke={COLORS.sky} strokeWidth="2.5" strokeLinecap="round" />
      </g>

      {/* teknisi menyemprot */}
      <g transform="translate(270,60)">
        <circle cx="30" cy="18" r="15" fill="#F5C9A1" />
        <path d="M15 17 a15 15 0 0 1 30 0 v-4 a15 9 0 0 0 -30 0 Z" fill={COLORS.navy} />
        <rect x="15" y="5" width="26" height="9" rx="4.5" fill={COLORS.brand} />
        <rect x="39" y="7" width="11" height="4.5" rx="2.25" fill={COLORS.navy} />
        <path d="M24 24 a7 7 0 0 0 11 0" stroke={COLORS.navy} strokeWidth="2" fill="none" strokeLinecap="round" />
        <rect x="12" y="32" width="36" height="44" rx="12" fill={COLORS.brand} />
        <rect x="26" y="32" width="8" height="18" rx="2" fill={COLORS.brandDeep} />
        <rect x="16" y="76" width="10" height="34" rx="4" fill={COLORS.navy} />
        <rect x="34" y="76" width="10" height="34" rx="4" fill={COLORS.navy} />
        <rect x="11" y="110" width="17" height="7" rx="3.5" fill={COLORS.navy} />
        <rect x="32" y="110" width="17" height="7" rx="3.5" fill={COLORS.navy} />
        {/* lengan memegang spray */}
        <path d="M48 42 C 62 36, 74 30, 84 26" stroke={COLORS.brandDeep} strokeWidth="7" strokeLinecap="round" fill="none" />
        <circle cx="86" cy="25" r="4.5" fill="#F5C9A1" />
        <rect x="80" y="8" width="15" height="19" rx="3.5" fill={COLORS.navy} />
        <rect x="94" y="11" width="7" height="5" rx="2" fill={COLORS.brandDeep} />
        {/* kabut semprot */}
        <circle cx="110" cy="16" r="2.5" fill={COLORS.sky} />
        <circle cx="124" cy="24" r="2.2" fill={COLORS.sky} opacity="0.85" />
        <circle cx="138" cy="32" r="2" fill={COLORS.sky} opacity="0.7" />
        <circle cx="150" cy="42" r="1.8" fill={COLORS.sky} opacity="0.55" />
        <path d="M116 8 l0 6 M113 11 l6 0" stroke={COLORS.sky} strokeWidth="1.8" strokeLinecap="round" />
        {/* kotak peralatan di lantai */}
        <rect x="-38" y="128" width="26" height="18" rx="3" fill={COLORS.amber} />
        <path d="M-31 128 v-5 h12 v5" fill="none" stroke={COLORS.amber} strokeWidth="4" />
      </g>

      {/* dinding + unit AC */}
      <rect x="470" y="44" width="250" height="124" rx="14" fill="#ffffff" opacity="0.85" stroke={COLORS.line} strokeWidth="2.5" />
      <rect x="496" y="82" width="190" height="44" rx="10" fill={COLORS.navy} />
      <rect x="496" y="82" width="190" height="13" rx="6.5" fill={COLORS.brandDeep} opacity="0.55" />
      <rect x="508" y="100" width="122" height="9" rx="4.5" fill={COLORS.sky} />
      <circle cx="668" cy="104" r="4.5" fill={COLORS.mint} />
      <circle cx="668" cy="104" r="1.8" fill="#ffffff" />
      {/* kilau bersih */}
      <path d="M700 66 l4.5 9 9 4.5 -9 4.5 -4.5 9 -4.5 -9 -9 -4.5 9 -4.5 Z" fill={COLORS.amber} />
      <path d="M712 96 l2.5 5 5 2.5 -5 2.5 -2.5 5 -2.5 -5 -5 -2.5 5 -2.5 Z" fill="#ffffff" opacity="0.9" />

      {/* aliran dingin keluar ke kanan */}
      <path d="M700 108 C 732 104, 754 112, 784 108" stroke={COLORS.sky} strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.65" />
      <path d="M700 122 C 738 118, 764 126, 796 122" stroke={COLORS.sky} strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.45" />
      <path d="M700 136 C 730 133, 748 139, 772 136" stroke={COLORS.sky} strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.3" />

      {/* kepingan salju dekoratif */}
      <g stroke={COLORS.sky} strokeWidth="2.5" strokeLinecap="round">
        <path d="M180 36 v12 M174 42 h12 M176 38 l8 8 M184 38 l-8 8" opacity="0.7" />
        <path d="M640 22 v10 M635 27 h10" opacity="0.6" />
        <path d="M120 60 v9 M115.5 64.5 h9" opacity="0.5" />
      </g>
      <circle cx="770" cy="160" r="4" fill={COLORS.sky} opacity="0.6" />
      <circle cx="420" cy="172" r="3" fill={COLORS.sky} opacity="0.5" />
      <circle cx="350" cy="34" r="3.5" fill="#ffffff" opacity="0.9" />

      {/* tanaman hias kanan */}
      <g>
        <path d="M806 152 h30 l-5 22 h-20 Z" fill={COLORS.coral} />
        <path d="M821 150 C 821 138, 812 136, 810 128 M821 150 C 821 140, 830 138, 833 130 M821 150 v-18" stroke={COLORS.mint} strokeWidth="4" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/* --------------------------- THUMBNAIL PER LAYANAN --------------------------- */

function Drop({ x = 0, y = 0, size = 1, color = COLORS.brand, opacity = 1 }) {
  return (
    <path
      d="M0 0 C4 6 6 9 6 12 a6 6 0 1 1 -12 0 C-6 9 -4 6 0 0 Z"
      transform={`translate(${x},${y}) scale(${size})`}
      fill={color}
      opacity={opacity}
    />
  );
}

function SpeedLines({ color, y = 30 }) {
  return <path d={`M12 ${y} h16 M8 ${y + 10} h20 M14 ${y + 20} h12`} stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.5" />;
}

/** AC: cuci/maintenance — AC bersinar dengan percikan bersih & kilau. */
export function AcCuciThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.skyTint} />
      <rect x="46" y="16" width="108" height="34" rx="9" fill={COLORS.navy} />
      <rect x="54" y="24" width="74" height="8" rx="4" fill={COLORS.sky} />
      <circle cx="140" cy="33" r="4" fill={COLORS.mint} />
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${64 + i * 36} 56 q6 16 0 32 q-5 12 2 22`} stroke={COLORS.brand} strokeWidth="4.5" strokeLinecap="round" fill="none" opacity={0.9 - i * 0.25} />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <circle key={`b${i}`} cx={54 + i * 14} cy={62 + (i % 2) * 10} r="3" fill={COLORS.sky} />
      ))}
      <path d="M156 24 l4 8 8 4 -8 4 -4 8 -4 -8 -8 -4 8 -4 Z" fill={COLORS.amber} />
      <path d="M36 70 l3 6 6 3 -6 3 -3 6 -3 -6 -6 -3 6 -3 Z" fill="#ffffff" opacity="0.9" />
    </svg>
  );
}

/** AC: perbaikan/bocor — AC dengan tetesan air & kunci pas. */
export function AcPerbaikanThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.skyTint} />
      <rect x="46" y="16" width="108" height="34" rx="9" fill={COLORS.navy} />
      <rect x="54" y="24" width="74" height="8" rx="4" fill={COLORS.sky} />
      <circle cx="140" cy="33" r="4" fill={COLORS.coral} />
      {/* tetesan bocor */}
      <Drop x={70} y={60} color={COLORS.brand} />
      <Drop x={96} y={68} size={0.8} color={COLORS.brand} opacity={0.8} />
      <Drop x={122} y={60} size={0.9} color={COLORS.brand} opacity={0.9} />
      {/* genangan */}
      <ellipse cx="100" cy="96" rx="34" ry="5" fill={COLORS.sky} opacity="0.5" />
      {/* kunci pas */}
      <g transform="translate(158,72) rotate(30)">
        <rect x="-2.5" y="-10" width="5" height="18" rx="2.5" fill={COLORS.amber} />
        <circle cx="0" cy="-10" r="5.5" fill="none" stroke={COLORS.amber} strokeWidth="3.5" />
      </g>
    </svg>
  );
}

/** AC: isi freon — tabung freon dengan selang & indikator. */
export function AcFreonThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.skyTint} />
      <circle cx="30" cy="26" r="12" fill="#ffffff" opacity="0.7" />
      <circle cx="176" cy="80" r="10" fill="#ffffff" opacity="0.6" />
      {/* tabung freon */}
      <rect x="76" y="30" width="34" height="56" rx="7" fill={COLORS.navy} />
      <rect x="82" y="40" width="22" height="24" rx="4" fill={COLORS.skyTint} />
      <path d="M84 56 h18" stroke={COLORS.brand} strokeWidth="3" />
      <rect x="88" y="22" width="10" height="8" rx="2" fill={COLORS.brandDeep} />
      {/* selang */}
      <path d="M93 22 C 93 8, 130 8, 136 20 C 140 30, 132 36, 124 34" stroke={COLORS.amber} strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="124" cy="34" r="3" fill={COLORS.amber} />
      {/* heksagon freon */}
      <path d="M148 58 l8 -5 8 5 v10 l-8 5 -8 -5 Z" fill={COLORS.mint} opacity="0.85" />
      <text x="156" y="67" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#ffffff" fontFamily="sans-serif">R</text>
      <Drop x={56} y={58} size={0.7} color={COLORS.sky} />
      <Drop x={44} y={74} size={0.5} color={COLORS.sky} opacity={0.7} />
    </svg>
  );
}

/** AC: bongkar pasang — AC dengan tanda panah keluar-masuk & obeng. */
export function AcBongkarThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.skyTint} />
      <rect x="34" y="38" width="86" height="30" rx="8" fill={COLORS.navy} />
      <rect x="40" y="45" width="60" height="7" rx="3.5" fill={COLORS.sky} />
      <circle cx="108" cy="53" r="3.5" fill={COLORS.mint} />
      {/* dinding target */}
      <rect x="146" y="24" width="34" height="60" rx="5" fill="#ffffff" stroke={COLORS.line} strokeWidth="2.5" />
      <rect x="154" y="34" width="18" height="18" rx="3" fill={COLORS.amberTint} stroke={COLORS.amber} strokeWidth="2" strokeDasharray="4 3" />
      {/* panah bolak-balik */}
      <path d="M46 82 h28 m0 0 l-7 -6 m7 6 l-7 6" stroke={COLORS.brand} strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M126 82 h-28 m0 0 l7 -6 m-7 6 l7 6" stroke={COLORS.amber} strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* sekrup terlepas */}
      <circle cx="86" cy="24" r="4" fill="none" stroke={COLORS.amber} strokeWidth="2.5" />
      <path d="M86 17 v-4" stroke={COLORS.amber} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="26" cy="26" r="3" fill={COLORS.sky} opacity="0.6" />
    </svg>
  );
}

/** AC: lainnya — AC dengan tanda tanya & gelembung pertanyaan. */
export function AcLainnyaThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.skyTint} />
      <rect x="40" y="30" width="96" height="30" rx="8" fill={COLORS.navy} />
      <rect x="48" y="37" width="66" height="7" rx="3.5" fill={COLORS.sky} />
      <path d="M62 66 q4 12 -2 22" stroke={COLORS.brand} strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M96 66 q4 12 -2 22" stroke={COLORS.brand} strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.45" />
      {/* gelembung tanya */}
      <circle cx="156" cy="46" r="20" fill="#ffffff" stroke={COLORS.line} strokeWidth="2.5" />
      <text x="156" y="54" textAnchor="middle" fontSize="22" fontWeight="bold" fill={COLORS.brand} fontFamily="sans-serif">?</text>
      <circle cx="176" cy="74" r="7" fill={COLORS.amberTint} stroke={COLORS.amber} strokeWidth="2" />
      <circle cx="170" cy="86" r="4.5" fill={COLORS.amberTint} stroke={COLORS.amber} strokeWidth="1.6" />
    </svg>
  );
}

/** Tukang: listrik — stopkontak, colokan, dan petir. */
export function TukangListrikThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.amberTint} />
      {/* papan listrik */}
      <rect x="76" y="18" width="48" height="60" rx="8" fill="#ffffff" stroke={COLORS.amber} strokeWidth="2.5" />
      {/* stopkontak */}
      <circle cx="100" cy="42" r="14" fill={COLORS.skyTint} stroke={COLORS.navy} strokeWidth="2.5" />
      <circle cx="95" cy="42" r="2" fill={COLORS.navy} />
      <circle cx="105" cy="42" r="2" fill={COLORS.navy} />
      {/* saklar */}
      <rect x="92" y="62" width="16" height="10" rx="2" fill={COLORS.brand} />
      {/* petir */}
      <path d="M142 24 l-10 20 h9 l-7 18 18 -24 h-10 l8 -14 Z" fill={COLORS.amber} stroke="none" />
      {/* kabel bergelombang */}
      <path d="M30 30 q10 8 0 16 q-10 8 0 16" stroke={COLORS.navy} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.6" />
      <circle cx="42" cy="82" r="4" fill={COLORS.coral} opacity="0.8" />
    </svg>
  );
}

/** Tukang: ledeng/pipa — pipa dengan tetesan air & kunci inggris. */
export function TukangLedengThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.amberTint} />
      {/* pipa */}
      <path d="M30 36 h60 a14 14 0 0 1 14 14 v10" stroke={COLORS.navy} strokeWidth="14" fill="none" strokeLinecap="round" />
      <path d="M30 36 h60 a14 14 0 0 1 14 14 v10" stroke={COLORS.brand} strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.35" />
      <rect x="94" y="60" width="14" height="18" rx="3" fill={COLORS.brandDeep} />
      {/* tetesan dari pipa */}
      <Drop x={101} y={84} size={0.9} color={COLORS.sky} />
      <ellipse cx="101" cy="100" rx="16" ry="3.5" fill={COLORS.sky} opacity="0.5" />
      {/* keran */}
      <g transform="translate(146,40)">
        <rect x="-6" y="0" width="12" height="16" rx="3" fill={COLORS.navy} />
        <rect x="-3" y="-14" width="6" height="12" rx="3" fill={COLORS.navy} />
        <circle cx="0" cy="-16" r="5" fill={COLORS.coral} />
        <path d="M6 16 q0 8 6 8" stroke={COLORS.sky} strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
      <circle cx="34" cy="80" r="9" fill="#ffffff" opacity="0.7" />
    </svg>
  );
}

/** Tukang: cat & dinding — roller cat dengan jejak cat di dinding. */
export function TukangCatThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.amberTint} />
      {/* dinding dengan sapuan cat */}
      <rect x="120" y="10" width="80" height="100" fill="#ffffff" opacity="0.5" />
      <path d="M136 10 q-8 30 4 60 q4 20 -2 40" stroke={COLORS.brand} strokeWidth="16" fill="none" strokeLinecap="round" opacity="0.75" />
      <path d="M160 10 q-6 34 2 66" stroke={COLORS.sky} strokeWidth="12" fill="none" strokeLinecap="round" opacity="0.7" />
      {/* roller */}
      <g transform="translate(58,34) rotate(-12)">
        <rect x="-8" y="-26" width="16" height="40" rx="8" fill={COLORS.coral} />
        <rect x="-3" y="14" width="6" height="26" rx="3" fill={COLORS.navy} />
        <path d="M0 40 q0 10 -10 12" stroke={COLORS.navy} strokeWidth="4" fill="none" strokeLinecap="round" />
      </g>
      {/* kuas + kaleng */}
      <g transform="translate(84,84)">
        <rect x="0" y="0" width="22" height="14" rx="3" fill={COLORS.amber} />
        <path d="M4 14 l-2 10 h18 l-2 -10" fill={COLORS.navy} opacity="0.85" />
      </g>
      <circle cx="34" cy="22" r="3.5" fill={COLORS.coral} opacity="0.7" />
      <circle cx="48" cy="14" r="2.5" fill={COLORS.brand} opacity="0.7" />
    </svg>
  );
}

/** Tukang: atap & plafon — atap dengan genteng lepas & palu. */
export function TukangAtapThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.amberTint} />
      <circle cx="30" cy="26" r="12" fill="#ffffff" opacity="0.7" />
      {/* atap */}
      <path d="M42 74 L100 26 L158 74 Z" fill={COLORS.navy} />
      <path d="M42 74 L100 26 L158 74" stroke={COLORS.amber} strokeWidth="3" fill="none" strokeLinejoin="round" />
      {/* baris genteng */}
      <path d="M64 60 h72 M80 46 h40" stroke={COLORS.brandDeep} strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
      {/* genteng lepas */}
      <rect x="96" y="50" width="14" height="10" rx="2" fill={COLORS.amber} transform="rotate(14 103 55)" />
      {/* palu */}
      <g transform="translate(152,86) rotate(-30)">
        <rect x="-2.5" y="-16" width="5" height="24" rx="2.5" fill={COLORS.navy} />
        <rect x="-9" y="-20" width="18" height="7" rx="3" fill={COLORS.amber} />
      </g>
      {/* titik bocor */}
      <Drop x={130} y={82} size={0.6} color={COLORS.brand} opacity={0.7} />
    </svg>
  );
}

/** Tukang: serba bisa — helm proyek + alat menyilang. */
export function TukangSerbaBisaThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.amberTint} />
      {/* helm */}
      <path d="M62 66 a38 30 0 0 1 76 0 Z" fill={COLORS.amber} />
      <rect x="54" y="64" width="92" height="9" rx="4.5" fill={COLORS.navy} />
      <path d="M92 40 q8 -6 16 0" stroke="#ffffff" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7" />
      {/* palu & kunci pas menyilang di bawah helm */}
      <g transform="translate(86,92) rotate(40)">
        <rect x="-2.5" y="-12" width="5" height="20" rx="2.5" fill={COLORS.navy} />
        <rect x="-8" y="-15" width="16" height="6" rx="3" fill={COLORS.amber} />
      </g>
      <g transform="translate(114,92) rotate(-40)">
        <rect x="-2.5" y="-12" width="5" height="20" rx="2.5" fill={COLORS.navy} />
        <circle cx="0" cy="-12" r="5.5" fill="none" stroke={COLORS.amber} strokeWidth="3.5" />
      </g>
      <circle cx="170" cy="28" r="6" fill={COLORS.brand} opacity="0.5" />
    </svg>
  );
}

/** Kendaraan: service berkala — mobil di atas lift bengkel dengan wrench badge. */
export function KendaraanBerkalaThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.mintTint} />
      {/* lift */}
      <rect x="58" y="74" width="84" height="7" rx="3.5" fill={COLORS.navy} opacity="0.85" />
      <rect x="70" y="81" width="10" height="22" fill={COLORS.navy} opacity="0.7" />
      <rect x="120" y="81" width="10" height="22" fill={COLORS.navy} opacity="0.7" />
      {/* mobil di atas lift */}
      <rect x="58" y="48" width="84" height="22" rx="8" fill={COLORS.mint} />
      <path d="M70 48 L82 30 L118 30 L130 48 Z" fill={COLORS.mint} opacity="0.9" />
      <rect x="86" y="34" width="26" height="13" rx="2" fill={COLORS.skyTint} />
      <circle cx="72" cy="70" r="7" fill={COLORS.navy} />
      <circle cx="128" cy="70" r="7" fill={COLORS.navy} />
      {/* kunci pas mengambang */}
      <g transform="translate(156,36) rotate(35)">
        <rect x="-2.5" y="-10" width="5" height="18" rx="2.5" fill={COLORS.amber} />
        <circle cx="0" cy="-10" r="5.5" fill="none" stroke={COLORS.amber} strokeWidth="3.5" />
      </g>
      <circle cx="36" cy="32" r="8" fill="#ffffff" opacity="0.7" />
    </svg>
  );
}

/** Kendaraan: ganti oli — botol oli meneteskan tetes emas ke mesin. */
export function KendaraanOliThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.mintTint} />
      {/* botol oli */}
      <g transform="translate(74,16) rotate(18)">
        <rect x="0" y="10" width="34" height="42" rx="6" fill={COLORS.navy} />
        <rect x="10" y="2" width="14" height="8" rx="2" fill={COLORS.brandDeep} />
        <rect x="6" y="20" width="22" height="16" rx="3" fill={COLORS.skyTint} opacity="0.9" />
        <path d="M10 28 h14" stroke={COLORS.amber} strokeWidth="3" strokeLinecap="round" />
      </g>
      {/* tetesan oli */}
      <Drop x={106} y={66} size={0.8} color={COLORS.amber} />
      <Drop x={98} y={78} size={0.5} color={COLORS.amber} opacity={0.7} />
      {/* blok mesin sederhana */}
      <rect x="92" y="84" width="44" height="18" rx="4" fill={COLORS.navy} opacity="0.9" />
      <circle cx="104" cy="93" r="3" fill={COLORS.sky} />
      <circle cx="124" cy="93" r="3" fill={COLORS.sky} />
      <path d="M136 93 h12" stroke={COLORS.navy} strokeWidth="5" strokeLinecap="round" opacity="0.8" />
      <circle cx="42" cy="30" r="8" fill="#ffffff" opacity="0.7" />
    </svg>
  );
}

/** Kendaraan: rem & kaki-kaki — cakram rem berputar dengan kampas. */
export function KendaraanRemThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.mintTint} />
      {/* cakram rem */}
      <circle cx="100" cy="55" r="34" fill={COLORS.skyTint} stroke={COLORS.navy} strokeWidth="7" />
      <circle cx="100" cy="55" r="30" fill="none" stroke={COLORS.line} strokeWidth="2" strokeDasharray="5 6" />
      <circle cx="100" cy="55" r="11" fill={COLORS.navy} />
      {[0, 72, 144, 216, 288].map((a) => (
        <circle key={a} cx={100 + 20 * Math.cos((a * Math.PI) / 180)} cy={55 + 20 * Math.sin((a * Math.PI) / 180)} r="3.5" fill={COLORS.navy} />
      ))}
      {/* kampas rem */}
      <path d="M136 40 a34 34 0 0 1 0 30" stroke={COLORS.coral} strokeWidth="10" fill="none" strokeLinecap="round" />
      <path d="M64 40 a34 34 0 0 0 0 30" stroke={COLORS.coral} strokeWidth="10" fill="none" strokeLinecap="round" opacity="0.55" />
      {/* percikan gesekan */}
      <path d="M150 30 l6 -6 M156 44 l8 -3 M154 74 l7 4" stroke={COLORS.amber} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Kendaraan: tambal ban — ban dengan perban/salep dan centang. */
export function KendaraanBanThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.mintTint} />
      {/* ban */}
      <circle cx="92" cy="56" r="36" fill={COLORS.navy} />
      <circle cx="92" cy="56" r="22" fill={COLORS.skyTint} />
      <circle cx="92" cy="56" r="9" fill={COLORS.navy} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect key={a} x="89.5" y="18" width="5" height="8" rx="2" fill={COLORS.brandDeep} transform={`rotate(${a} 92 56)`} />
      ))}
      {/* perban tambalan */}
      <g transform="rotate(-18 128 34)">
        <rect x="112" y="26" width="34" height="16" rx="4" fill={COLORS.coralTint} stroke={COLORS.coral} strokeWidth="2" />
        <path d="M120 34 h6 M132 34 h6" stroke={COLORS.coral} strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* pompa angin kecil */}
      <g transform="translate(160,64)">
        <rect x="0" y="0" width="10" height="26" rx="4" fill={COLORS.mint} />
        <path d="M5 0 v-10" stroke={COLORS.navy} strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="34" cy="26" r="8" fill="#ffffff" opacity="0.7" />
    </svg>
  );
}

/** Kendaraan: cuci & detailing — busa sabun, gelembung, dan kilau. */
export function KendaraanCuciThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.mintTint} />
      {/* mobil berbusa */}
      <rect x="52" y="52" width="96" height="28" rx="10" fill={COLORS.brand} opacity="0.85" />
      <path d="M66 52 L80 32 L120 32 L134 52 Z" fill={COLORS.brand} opacity="0.7" />
      <rect x="84" y="37" width="30" height="14" rx="3" fill={COLORS.skyTint} />
      <circle cx="70" cy="82" r="9" fill={COLORS.navy} />
      <circle cx="130" cy="82" r="9" fill={COLORS.navy} />
      {/* busa */}
      <circle cx="62" cy="50" r="8" fill="#ffffff" opacity="0.95" />
      <circle cx="76" cy="42" r="6" fill="#ffffff" opacity="0.85" />
      <circle cx="126" cy="46" r="7" fill="#ffffff" opacity="0.9" />
      <circle cx="140" cy="56" r="5" fill="#ffffff" opacity="0.8" />
      {/* gelembung naik */}
      <circle cx="150" cy="26" r="6" fill="none" stroke={COLORS.sky} strokeWidth="2.5" />
      <circle cx="162" cy="14" r="4" fill="none" stroke={COLORS.sky} strokeWidth="2" opacity="0.7" />
      {/* semprotan air */}
      <path d="M30 40 q8 14 22 20" stroke={COLORS.sky} strokeWidth="3.5" fill="none" strokeLinecap="round" strokeDasharray="2 6" />
      <circle cx="26" cy="34" r="5" fill={COLORS.navy} />
      <path d="M160 84 l3 6 6 3 -6 3 -3 6 -3 -6 -6 -3 6 -3 Z" fill={COLORS.amber} transform="translate(-14,-16) scale(0.9)" />
    </svg>
  );
}

/** Kendaraan: lainnya — mobil dengan gelembung tanya & kunci mobil. */
export function KendaraanLainnyaThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.mintTint} />
      {/* mobil kecil */}
      <rect x="40" y="54" width="86" height="26" rx="9" fill={COLORS.mint} />
      <path d="M54 54 L68 36 L100 36 L112 54 Z" fill={COLORS.mint} opacity="0.9" />
      <rect x="72" y="40" width="24" height="13" rx="2" fill={COLORS.skyTint} />
      <circle cx="58" cy="82" r="8" fill={COLORS.navy} />
      <circle cx="108" cy="82" r="8" fill={COLORS.navy} />
      {/* gelembung tanya */}
      <circle cx="152" cy="44" r="18" fill="#ffffff" stroke={COLORS.line} strokeWidth="2.5" />
      <text x="152" y="51" textAnchor="middle" fontSize="20" fontWeight="bold" fill={COLORS.mint} fontFamily="sans-serif">?</text>
      {/* kunci mobil */}
      <g transform="translate(150,78) rotate(30)">
        <circle cx="-12" cy="0" r="5" fill="none" stroke={COLORS.amber} strokeWidth="3" />
        <path d="M-7 0 h16 M5 0 v5 M9 0 v4" stroke={COLORS.amber} strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="28" cy="30" r="7" fill="#ffffff" opacity="0.7" />
    </svg>
  );
}

/* ------------------------- THUMBNAIL KEBERSIHAN --------------------------- */

/** Thumbnail kategori Kebersihan & Laundry: ember berbusa + botol spray + kilau. */
export function KebersihanThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="kebersihanBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F4FBFA" />
          <stop offset="100%" stopColor={COLORS.mintTint} />
        </linearGradient>
      </defs>
      <rect width="200" height="110" fill="url(#kebersihanBg)" />
      {/* ember berbusa */}
      <path d="M62 58 h64 l-7 38 a6 6 0 0 1 -6 5 h-38 a6 6 0 0 1 -6 -5 Z" fill={COLORS.brand} />
      <path d="M62 58 h64 l-2 11 h-60 Z" fill={COLORS.brandDeep} opacity="0.6" />
      <ellipse cx="94" cy="58" rx="32" ry="7" fill={COLORS.navy} />
      {/* busa melimpah */}
      <circle cx="78" cy="52" r="9" fill="#ffffff" />
      <circle cx="94" cy="47" r="11" fill="#ffffff" />
      <circle cx="110" cy="52" r="8" fill="#ffffff" />
      <circle cx="86" cy="42" r="5" fill="#ffffff" opacity="0.9" />
      {/* gagang ember */}
      <path d="M64 56 C 70 36, 118 36, 124 56" stroke={COLORS.navy} strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* botol spray */}
      <g transform="translate(146,44) rotate(10)">
        <rect x="0" y="12" width="16" height="30" rx="4" fill={COLORS.mint} />
        <rect x="3" y="4" width="10" height="8" rx="2" fill={COLORS.brandDeep} />
        <rect x="12" y="5" width="7" height="5" rx="2" fill={COLORS.navy} />
      </g>
      <circle cx="168" cy="38" r="2.5" fill={COLORS.sky} />
      <circle cx="176" cy="46" r="2" fill={COLORS.sky} opacity="0.7" />
      {/* kilau */}
      <path d="M30 30 l4 8 8 4 -8 4 -4 8 -4 -8 -8 -4 8 -4 Z" fill={COLORS.amber} transform="scale(0.8) translate(8,8)" />
      <path d="M36 84 l2.5 5 5 2.5 -5 2.5 -2.5 5 -2.5 -5 -5 -2.5 5 -2.5 Z" fill="#ffffff" opacity="0.9" />
      <circle cx="150" cy="90" r="3" fill={COLORS.sky} opacity="0.6" />
    </svg>
  );
}

/** Layanan: bersihkan rumah / unit apartemen — rumah dengan sapuan bersih & centang. */
export function KebersihanRumahThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.mintTint} />
      {/* rumah */}
      <path d="M52 62 L100 24 L148 62 Z" fill={COLORS.navy} />
      <rect x="64" y="62" width="72" height="40" fill="#ffffff" stroke={COLORS.line} strokeWidth="2.5" />
      <rect x="92" y="78" width="16" height="24" fill={COLORS.mint} />
      <rect x="72" y="70" width="12" height="10" rx="2" fill={COLORS.skyTint} stroke={COLORS.brand} strokeWidth="2" />
      <rect x="116" y="70" width="12" height="10" rx="2" fill={COLORS.skyTint} stroke={COLORS.brand} strokeWidth="2" />
      {/* sapuan kilau */}
      <path d="M28 28 l4 8 8 4 -8 4 -4 8 -4 -8 -8 -4 8 -4 Z" fill={COLORS.amber} transform="scale(0.75) translate(10,10)" />
      {/* sapu ijuk menyandar */}
      <g transform="translate(160,54) rotate(18)">
        <rect x="-2.5" y="-26" width="5" height="34" rx="2.5" fill={COLORS.navy} />
        <path d="M-10 8 L10 8 L14 30 L-14 30 Z" fill={COLORS.amber} />
        <path d="M-8 30 v6 M-3 30 v7 M3 30 v7 M8 30 v6" stroke={COLORS.amber} strokeWidth="2.5" strokeLinecap="round" />
      </g>
      {/* centang */}
      <g transform="translate(148,88)">
        <circle cx="0" cy="0" r="10" fill={COLORS.mint} />
        <path d="M-4 0 l3.5 3.5 6 -7" stroke="#ffffff" strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="36" cy="90" r="4" fill={COLORS.sky} opacity="0.6" />
    </svg>
  );
}

/** Layanan: cuci sofa & kasur — sofa dengan busa sabun & gelembung. */
export function KebersihanSofaThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.mintTint} />
      {/* sofa */}
      <rect x="48" y="58" width="104" height="30" rx="9" fill={COLORS.brand} />
      <rect x="56" y="42" width="88" height="22" rx="7" fill={COLORS.brand} opacity="0.85" />
      <path d="M96 42 v22" stroke={COLORS.brandDeep} strokeWidth="2.5" opacity="0.5" />
      <rect x="44" y="52" width="14" height="36" rx="6" fill={COLORS.brandDeep} />
      <rect x="142" y="52" width="14" height="36" rx="6" fill={COLORS.brandDeep} />
      <circle cx="68" cy="90" r="5" fill={COLORS.navy} />
      <circle cx="132" cy="90" r="5" fill={COLORS.navy} />
      {/* busa di atas sandaran */}
      <circle cx="70" cy="38" r="7" fill="#ffffff" />
      <circle cx="84" cy="33" r="9" fill="#ffffff" />
      <circle cx="99" cy="37" r="6.5" fill="#ffffff" opacity="0.95" />
      <circle cx="113" cy="33" r="8" fill="#ffffff" opacity="0.9" />
      {/* gelembung naik */}
      <circle cx="146" cy="26" r="5.5" fill="none" stroke={COLORS.sky} strokeWidth="2.5" />
      <circle cx="158" cy="16" r="4" fill="none" stroke={COLORS.sky} strokeWidth="2" opacity="0.7" />
      <circle cx="36" cy="24" r="4.5" fill="none" stroke={COLORS.sky} strokeWidth="2" opacity="0.6" />
      {/* penyedot debu mini */}
      <g transform="translate(158,74) rotate(-14)">
        <rect x="0" y="0" width="22" height="9" rx="4.5" fill={COLORS.navy} />
        <rect x="17" y="-6" width="8" height="7" rx="2" fill={COLORS.amber} />
      </g>
    </svg>
  );
}

/** Layanan: laundry & setrika — tumpukan pakaian bersih + setrika + kilau. */
export function KebersihanLaundryThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.mintTint} />
      {/* tumpukan pakaian terlipat */}
      <rect x="56" y="78" width="76" height="16" rx="4" fill={COLORS.navy} />
      <rect x="60" y="64" width="68" height="15" rx="4" fill={COLORS.brand} />
      <rect x="64" y="50" width="60" height="15" rx="4" fill={COLORS.mint} />
      <rect x="70" y="38" width="48" height="13" rx="4" fill={COLORS.coral} opacity="0.85" />
      <path d="M72 70.5 h44 M76 57.5 h36" stroke="#ffffff" strokeWidth="1.6" opacity="0.4" />
      {/* setrika */}
      <g transform="translate(148,62) rotate(-8)">
        <path d="M0 14 a10 10 0 0 1 10 -10 h14 a6 6 0 0 1 6 6 v8 Z" fill={COLORS.sky} stroke={COLORS.navy} strokeWidth="2.5" />
        <path d="M18 4 q-3 -7 -10 -7" stroke={COLORS.navy} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M6 14 v4 M14 14 v4 M22 14 v4" stroke={COLORS.navy} strokeWidth="1.8" opacity="0.5" />
      </g>
      {/* uap setrika */}
      <path d="M158 46 q-3 -6 1 -10 M166 48 q-2 -5 2 -9" stroke={COLORS.sky} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.8" />
      {/* gantungan baju */}
      <g transform="translate(38,30)">
        <path d="M0 8 C 0 2, 10 2, 10 8" stroke={COLORS.navy} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M-10 22 L5 8 L20 22 Z" fill={COLORS.amberTint} stroke={COLORS.amber} strokeWidth="2.5" strokeLinejoin="round" />
      </g>
      {/* kilau */}
      <path d="M30 66 l3 6 6 3 -6 3 -3 6 -3 -6 -6 -3 6 -3 Z" fill={COLORS.amber} transform="scale(0.85) translate(6,12)" />
      <circle cx="168" cy="26" r="4" fill={COLORS.sky} opacity="0.6" />
    </svg>
  );
}

/* Resolver: key = `${category_id}:${icon}` sesuai data di supabase/seed.sql. */
export const SERVICE_THUMBS = {
  "ac:sparkles": AcCuciThumb,
  "ac:wrench": AcPerbaikanThumb,
  "ac:droplet": AcFreonThumb,
  "ac:package-open": AcBongkarThumb,
  "ac:help-circle": AcLainnyaThumb,
  "tukang:zap": TukangListrikThumb,
  "tukang:shower-head": TukangLedengThumb,
  "tukang:paint-roller": TukangCatThumb,
  "tukang:building-2": TukangAtapThumb,
  "tukang:hard-hat": TukangSerbaBisaThumb,
  "kendaraan:settings-2": KendaraanBerkalaThumb,
  "kendaraan:droplet": KendaraanOliThumb,
  "kendaraan:disc": KendaraanRemThumb,
  "kendaraan:life-buoy": KendaraanBanThumb,
  "kendaraan:spray-can": KendaraanCuciThumb,
  "kendaraan:help-circle": KendaraanLainnyaThumb,
  "kebersihan:brush": KebersihanRumahThumb,
  "kebersihan:home": KebersihanRumahThumb,
  "kebersihan:armchair": KebersihanSofaThumb,
  "kebersihan:shirt": KebersihanLaundryThumb,
};

/** Thumbnail untuk satu layanan; foto kustom (jika ada) menang atas ilustrasi, fallback ke thumbnail kategori bila kombinasi tak dikenal. */
export function ServiceThumb({ categoryId, icon, imageUrl, ...props }) {
  if (imageUrl) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={imageUrl} alt="" loading="lazy" decoding="async" {...props} />
    );
  }
  const Thumb = SERVICE_THUMBS[`${categoryId}:${icon}`] || CATEGORY_THUMBS[categoryId] || AcThumb;
  return <Thumb {...props} />;
}
