// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  RewardsConverterAccount,
  RewardsConverterHistory,
  RewardsConverterInfo,
} from "@strato/shared-types";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * This test expands the real history and reads its amounts. Only the HTTP client and the signed-in account
 * are replaced, so what is checked is the form each amount is shown in.
 */

const E18 = 10n ** 18n;
const REWARDS = { address: "4".repeat(40), symbol: "Rewards Points", decimals: 18 };
const STRATO = { address: "2".repeat(40), symbol: "STRATO", decimals: 18 };

const state: RewardsConverterInfo = {
  configured: true,
  address: "1".repeat(40),
  rewardsToken: REWARDS,
  stratoToken: STRATO,
  rate: E18.toString(),
  paused: false,
  reserve: "0",
  maxConvertible: "0",
};
const account: RewardsConverterAccount = {
  balance: "0",
  stratoBalance: "0",
  totalConverted: "6125000000000000000",
  totalReceived: "5333333334884884833",
  conversionCount: 3,
};
const history: RewardsConverterHistory = {
  totalCount: 3,
  data: [
    // 0.125 burned at a rate of 0.0000000124124124 pays 0.0000000015515515
    { timestamp: "2026-11-19T22:52:00Z", converted: "125000000000000000", received: "1551551500", rate: "12412412400", transactionHash: "a".repeat(64) },
    // One unit over 1 burned at a third: both amounts carry all 18 decimals
    { timestamp: "2026-11-19T17:45:00Z", converted: "1000000000000000001", received: "333333333333333333", rate: "333333333333333333", transactionHash: "b".repeat(64) },
    { timestamp: "2026-11-19T17:36:00Z", converted: (4n * E18).toString(), received: (4n * E18).toString(), rate: E18.toString(), transactionHash: "c".repeat(64) },
  ],
};

vi.mock("@/lib/axios", () => ({
  api: {
    get: vi.fn(async (path: string) => ({
      data: path.endsWith("/history") ? history : path.endsWith("/account") ? account : state,
    })),
  },
}));
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({ isLoggedIn: true, userAddress: "3".repeat(40) }),
}));

import ConversionHistory from "@/components/rewardsConverter/ConversionHistory";

afterEach(cleanup);

it("shows every amount in the short form of the convert card", async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <ConversionHistory rewardsToken={REWARDS} stratoToken={STRATO} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Conversion History" }));

  const rows = await waitFor(() => {
    const body = screen.getAllByRole("row").slice(1);
    expect(body).toHaveLength(3);
    return body;
  });
  const cells = rows.map((row) => Array.from(row.querySelectorAll("td")).slice(1).map((cell) => cell.textContent));
  expect(cells).toEqual([
    ["0.125 Rewards Points", "0.0...1551 STRATO", "0.0...1241"],
    ["1.000000 Rewards Points", "0.3333 STRATO", "0.3333"],
    ["4.00 Rewards Points", "4.00 STRATO", "1.0000"],
  ]);

  await waitFor(() => screen.getByText("6.125 Rewards Points"));
  screen.getByText("5.333333 STRATO");
});
