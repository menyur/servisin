import { Snowflake, Hammer, Car, Wrench } from "lucide-react";

export const CATEGORY_ICONS = {
  snowflake: Snowflake,
  hammer: Hammer,
  car: Car,
  wrench: Wrench,
};

export function CategoryIcon({ name, ...props }) {
  const Icon = CATEGORY_ICONS[name] || Wrench;
  return <Icon {...props} />;
}
