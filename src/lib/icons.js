import {
  Snowflake,
  Hammer,
  Car,
  Wrench,
  Sparkles,
  Droplet,
  PackageOpen,
  HelpCircle,
  Zap,
  ShowerHead,
  PaintRoller,
  Building2,
  HardHat,
  Settings2,
  Disc,
  LifeBuoy,
  SprayCan,
} from "lucide-react";

// Key ditulis kebab-case supaya konsisten dengan nilai kolom "icon" di database.
export const ICONS = {
  snowflake: Snowflake,
  hammer: Hammer,
  car: Car,
  wrench: Wrench,
  sparkles: Sparkles,
  droplet: Droplet,
  "package-open": PackageOpen,
  "help-circle": HelpCircle,
  zap: Zap,
  "shower-head": ShowerHead,
  "paint-roller": PaintRoller,
  "building-2": Building2,
  "hard-hat": HardHat,
  "settings-2": Settings2,
  disc: Disc,
  "life-buoy": LifeBuoy,
  "spray-can": SprayCan,
};

// Dipertahankan untuk kompatibilitas kode yang sudah ada (kategori).
export const CATEGORY_ICONS = ICONS;

export function CategoryIcon({ name, ...props }) {
  const Icon = ICONS[name] || Wrench;
  return <Icon {...props} />;
}

// Alias yang lebih jelas maksudnya untuk dipakai di kartu sub-layanan.
export function ServiceIcon({ name, ...props }) {
  const Icon = ICONS[name] || Wrench;
  return <Icon {...props} />;
}
