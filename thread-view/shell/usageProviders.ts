// Upstream's provider presentation for the page's Limits shelf (`src/panel/LimitsShelf.tsx`):
// each usage provider's short name and colour, by its driver, as upstream's usage limits draw them.
// Imported statically by the page; it reaches nothing of the view but the contracts.
import type { ServerProvider } from "@t3tools/contracts";

import { PROVIDER_PRESENTATION } from "../t3/src/components/usage/usageProviders.ts";

/** A provider's short name and colour, by its driver; undefined for a driver upstream does not present. */
export function usageProvider(driver: ServerProvider["driver"]): { readonly label: string; readonly color: string } | undefined {
  return Object.values(PROVIDER_PRESENTATION).find((entry) => entry.driverKind === driver);
}
