import { getJurisdictionLabel } from "../services/jurisdictionService";
import type { Jurisdiction } from "../types/topic";

interface JurisdictionBadgeProps {
  jurisdiction: Jurisdiction;
  jurisdictionName?: string;
}

export function JurisdictionBadge({ jurisdiction, jurisdictionName }: JurisdictionBadgeProps) {
  const label = getJurisdictionLabel({ jurisdiction, jurisdictionName });
  return (
    <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-medium text-quiet">{label}</span>
  );
}
