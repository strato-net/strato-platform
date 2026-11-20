// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RewardsConverterAccount, RewardsConverterInfo } from "@strato/shared-types";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * These tests render the real convert card and type into its amount input. Only the HTTP client, the signed-in
 * account and the fee line are replaced, so what is checked is which amounts the card marks invalid.
 */

const E18 = 10n ** 18n;

const chain = vi.hoisted(() => ({ state: null as unknown, account: null as unknown }));

vi.mock("@/lib/axios", () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(async (path: string) => ({ data: path.endsWith("/account") ? chain.account : chain.state })),
  },
}));
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({ isLoggedIn: true, userAddress: "3".repeat(40) }),
}));
vi.mock("@/context/UserTokensContext", () => ({
  useUserTokens: () => ({ fetchTokens: async () => undefined }),
}));
vi.mock("@/context/TokenContext", () => ({
  useTokenContext: () => ({ fetchUsdstBalance: async () => undefined }),
}));
vi.mock("@/components/NetworkFee", () => ({ default: () => null, FeeNotices: () => null }));

import ConvertRewardsCard from "@/components/rewardsConverter/ConvertRewardsCard";

// A balance of 100 against a reserve that pays for 60 at 1:1
const state: RewardsConverterInfo = {
  configured: true,
  address: "1".repeat(40),
  rewardsToken: { address: "4".repeat(40), symbol: "Rewards Points", decimals: 18 },
  stratoToken: { address: "2".repeat(40), symbol: "STRATO", decimals: 18 },
  rate: E18.toString(),
  paused: false,
  reserve: (60n * E18).toString(),
  maxConvertible: (60n * E18).toString(),
};
const account: RewardsConverterAccount = {
  balance: (100n * E18).toString(),
  stratoBalance: "0",
  totalConverted: "0",
  totalReceived: "0",
  conversionCount: 0,
};

const show = async () => {
  chain.state = state;
  chain.account = account;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <ConvertRewardsCard state={state} refetchState={async () => undefined} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  // The balance line shows once the account has loaded
  await waitFor(() => expect(screen.getByText(/Balance:/).textContent).toMatch(/100/));
};

const input = () => screen.getByPlaceholderText("0.00") as HTMLInputElement;
const convertButton = () => screen.getByRole("button", { name: "Convert Rewards Points" }) as HTMLButtonElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });

afterEach(cleanup);

describe("the convert amount input", () => {
  it("is not marked while it is empty", async () => {
    await show();
    expect(input().getAttribute("aria-invalid")).toBe("false");
    expect(input().className).not.toContain("destructive");
  });

  it.each(["0.000000000000000001", "1", "59.999999999999999999", "60"])(
    "takes %s, an amount that can be converted",
    async (value) => {
      await show();
      type(value);
      expect(input().getAttribute("aria-invalid")).toBe("false");
      expect(input().className).not.toContain("destructive");
      expect(convertButton().disabled).toBe(false);
    },
  );

  it.each([
    ["0", "zero"],
    ["60.000000000000000001", "one unit over what can be converted"],
    ["100", "the whole balance, more than the reserve pays for"],
    ["1.0000000000000000001", "a digit past the token's 18 decimals"],
    ["1e3", "an exponent"],
  ])("turns red on %s: %s", async (value) => {
    await show();
    type(value);
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(input().className).toContain("border-destructive");
    expect(convertButton().disabled).toBe(true);
  });

  it("holds a Max button that fills the most that can be converted", async () => {
    await show();
    const max = screen.getByRole("button", { name: "Max" });
    expect(input().parentElement?.contains(max)).toBe(true);
    fireEvent.click(max);
    expect(input().value).toBe("60.0");
    expect(input().getAttribute("aria-invalid")).toBe("false");
  });

  it.each([
    ["61", "Exceeds the reserve"],
    ["100.000000000000000001", "Exceeds your balance"],
    ["1.0000000000000000001", "Enter an amount above zero with at most 18 decimal places"],
  ])("says why %s is invalid in a tooltip: %s", async (value, reason) => {
    await show();
    type(value);
    fireEvent.focus(input());
    expect((await screen.findByRole("tooltip")).textContent).toBe(reason);
  });

  it("shows no tooltip on a valid amount", async () => {
    await show();
    type("60");
    fireEvent.focus(input());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("clears the mark once the amount is corrected", async () => {
    await show();
    type("61");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    type("60");
    expect(input().getAttribute("aria-invalid")).toBe("false");
  });
});
