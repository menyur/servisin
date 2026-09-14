// Ilustrasi SVG orisinal (bukan foto), memakai palet warna brand Servisin.
// Dipakai di hero landing page dan sebagai thumbnail kartu layanan per kategori.

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
  line: "#D7E7F0",
};

/** Ilustrasi besar untuk hero: rumah dengan tiga layanan (AC, tukang, kendaraan) mengelilinginya. */
export function HeroIllustration(props) {
  return (
    <svg viewBox="0 0 480 380" width="100%" height="auto" role="img" aria-label="Ilustrasi rumah dikelilingi layanan AC, tukang, dan kendaraan" {...props}>
      {/* blob dekoratif */}
      <circle cx="240" cy="190" r="165" fill={COLORS.skyTint} />
      <circle cx="90" cy="90" r="34" fill={COLORS.mintTint} opacity="0.8" />
      <circle cx="410" cy="300" r="26" fill={COLORS.amberTint} opacity="0.9" />

      {/* rumah di tengah */}
      <g transform="translate(170,120)">
        <rect x="0" y="46" width="140" height="94" rx="6" fill="#ffffff" stroke={COLORS.line} strokeWidth="2" />
        <path d="M -10 56 L 70 4 L 150 56 Z" fill={COLORS.navy} />
        <rect x="58" y="86" width="24" height="54" rx="2" fill={COLORS.brand} />
        <rect x="18" y="70" width="26" height="26" rx="2" fill={COLORS.skyTint} stroke={COLORS.brand} strokeWidth="2" />
        <rect x="96" y="70" width="26" height="26" rx="2" fill={COLORS.skyTint} stroke={COLORS.brand} strokeWidth="2" />
      </g>

      {/* unit AC di atas rumah, kiri */}
      <g transform="translate(90,60)">
        <rect x="0" y="0" width="72" height="24" rx="6" fill={COLORS.navy} />
        <rect x="6" y="5" width="60" height="6" rx="3" fill={COLORS.sky} />
        <path d="M12 26 C12 46, -4 54, -4 74" stroke={COLORS.sky} strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d="M36 26 C36 50, 20 58, 20 82" stroke={COLORS.sky} strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.75" />
      </g>

      {/* ikon kunci pas / tukang, kanan atas */}
      <g transform="translate(330,50)">
        <circle cx="30" cy="30" r="34" fill="#ffffff" stroke={COLORS.amberTint} strokeWidth="8" />
        <path
          d="M18 40 L34 24 M34 24 a6 6 0 1 0 -8 -8 a6 6 0 0 0 8 8 Z M14 44 a5 5 0 1 0 7 -7"
          stroke={COLORS.amber}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>

      {/* mobil kecil, kanan bawah */}
      <g transform="translate(300,270)">
        <rect x="0" y="14" width="80" height="24" rx="8" fill={COLORS.mint} />
        <path d="M10 14 L24 -2 L58 -2 L70 14 Z" fill={COLORS.mint} opacity="0.85" />
        <rect x="26" y="0" width="26" height="14" rx="2" fill={COLORS.mintTint} />
        <circle cx="18" cy="40" r="8" fill={COLORS.navy} />
        <circle cx="64" cy="40" r="8" fill={COLORS.navy} />
      </g>

      {/* garis putus-putus penghubung */}
      <path d="M170 150 C130 130, 110 100, 100 85" stroke={COLORS.brand} strokeWidth="2" strokeDasharray="4 5" fill="none" opacity="0.5" />
      <path d="M310 150 C330 120, 345 100, 350 85" stroke={COLORS.amber} strokeWidth="2" strokeDasharray="4 5" fill="none" opacity="0.5" />
      <path d="M300 220 C320 240, 330 255, 335 270" stroke={COLORS.mint} strokeWidth="2" strokeDasharray="4 5" fill="none" opacity="0.5" />
    </svg>
  );
}

/** Thumbnail kartu untuk kategori Service AC. */
export function AcThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.skyTint} />
      <rect x="50" y="24" width="100" height="28" rx="8" fill={COLORS.navy} />
      <rect x="58" y="30" width="84" height="7" rx="3.5" fill={COLORS.sky} />
      {[0, 1, 2, 3].map((i) => (
        <path
          key={i}
          d={`M${64 + i * 24} 54 C ${64 + i * 24} 74, ${50 + i * 24} 82, ${50 + i * 24} 98`}
          stroke={COLORS.brand}
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
          opacity={0.85 - i * 0.15}
        />
      ))}
      <circle cx="168" cy="26" r="14" fill="#ffffff" opacity="0.6" />
    </svg>
  );
}

/** Thumbnail kartu untuk kategori Jasa Tukang Rumah. */
export function TukangThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.amberTint} />
      <path d="M60 70 L100 34 L140 70 Z" fill={COLORS.navy} />
      <rect x="72" y="70" width="56" height="32" fill="#ffffff" stroke={COLORS.amber} strokeWidth="2" />
      <rect x="92" y="82" width="16" height="20" fill={COLORS.amber} />
      <g transform="translate(140,66) rotate(45)">
        <rect x="-3" y="-22" width="6" height="30" rx="3" fill={COLORS.amber} />
        <circle cx="0" cy="-24" r="7" fill="none" stroke={COLORS.amber} strokeWidth="4" />
      </g>
    </svg>
  );
}

/** Thumbnail kartu untuk kategori Service Kendaraan. */
export function KendaraanThumb(props) {
  return (
    <svg viewBox="0 0 200 110" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" {...props}>
      <rect width="200" height="110" fill={COLORS.mintTint} />
      <rect x="40" y="58" width="120" height="30" rx="10" fill={COLORS.mint} />
      <path d="M56 58 L74 34 L128 34 L146 58 Z" fill={COLORS.mint} opacity="0.85" />
      <rect x="80" y="40" width="40" height="18" rx="2" fill={COLORS.mintTint} />
      <circle cx="62" cy="90" r="11" fill={COLORS.navy} />
      <circle cx="140" cy="90" r="11" fill={COLORS.navy} />
      <path d="M20 50 L34 50 M14 60 L30 60" stroke={COLORS.mint} strokeWidth="3" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

export const CATEGORY_THUMBS = {
  ac: AcThumb,
  tukang: TukangThumb,
  kendaraan: KendaraanThumb,
};

export function CategoryThumb({ categoryId, ...props }) {
  const Thumb = CATEGORY_THUMBS[categoryId] || AcThumb;
  return <Thumb {...props} />;
}
