// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import AmountValue from "@/components/rewardsConverter/AmountValue";

const STRATO = { address: "2".repeat(40), symbol: "STRATO", decimals: 18 };
const shown = (raw: bigint) =>
  render(<TooltipProvider><AmountValue raw={raw} token={STRATO} /></TooltipProvider>).container.textContent;

afterEach(cleanup);

it.each<[bigint, string]>([
  // The amounts of the confirm dialog: 0.125 burned for 0.0000000015515515
  [125000000000000000n, "0.125 STRATO"],
  [1551551500n, "0.0...1551 STRATO"],
  [1n, "0.0...1 STRATO"],
  [500000000000000000n, "0.50 STRATO"],
  [0n, "0.0 STRATO"],
  // From one whole token up, the usual 2 to 6 decimals
  [10n ** 18n - 1n, "0.9999 STRATO"],
  [10n ** 18n, "1.0 STRATO"],
  [1234567891234567890000n, "1,234.567891 STRATO"],
])("shows %s as %s", (raw, text) => {
  expect(shown(raw)).toBe(text);
});
