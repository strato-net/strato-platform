// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  RewardsConverterAccount,
  RewardsConverterAdminStats,
  RewardsConverterInfo,
} from "@strato/shared-types";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * These tests render the real Set Rate, Fund Reserve and Withdraw Reserve forms, type into their inputs and
 * read the request each one makes. Only the HTTP client and the signed-in account are replaced, so what is checked is the
 * exact integer that leaves the browser for what was typed.
 */

const E18 = 10n ** 18n;
const USER = "3333333333333333333333333333333333333333";
const STRATO = { address: "2".repeat(40), symbol: "STRATO", decimals: 18 };

const chain = vi.hoisted(() => ({ state: null as unknown, account: null as unknown }));
const post = vi.hoisted(() =>
  vi.fn(async (_path: string, _body?: unknown) => ({
    data: { status: "Success", hash: "ab".repeat(32), issueId: null, executed: true },
  })),
);

vi.mock("@/lib/axios", () => ({
  api: {
    post,
    get: vi.fn(async (path: string) => ({ data: path.endsWith("/account") ? chain.account : chain.state })),
  },
}));
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({ isLoggedIn: true, userAddress: USER }),
}));
vi.mock("@/context/UserTokensContext", () => ({
  useUserTokens: () => ({ fetchTokens: async () => undefined }),
}));

import FundReserveForm from "@/components/admin/rewards-converter/FundReserveForm";
import SetRateForm from "@/components/admin/rewards-converter/SetRateForm";
import WithdrawReserveForm from "@/components/admin/rewards-converter/WithdrawReserveForm";

const converter = (overrides: Partial<RewardsConverterInfo> = {}): RewardsConverterInfo => ({
  configured: true,
  address: "1".repeat(40),
  rewardsToken: { address: "4".repeat(40), symbol: "CATA", decimals: 18 },
  stratoToken: STRATO,
  rate: E18.toString(),
  paused: false,
  reserve: "0",
  maxConvertible: "0",
  ...overrides,
});

const statsOf = (outstandingSupply: bigint): RewardsConverterAdminStats => ({
  totalBurned: "0",
  totalPaid: "0",
  conversionCount: 0,
  outstandingSupply: outstandingSupply.toString(),
  totalFunded: "0",
  totalWithdrawn: "0",
});

const accountWith = (stratoBalance: bigint): RewardsConverterAccount => ({
  balance: "0",
  stratoBalance: stratoBalance.toString(),
  totalConverted: "0",
  totalReceived: "0",
  conversionCount: 0,
});

const show = (form: ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>{form}</TooltipProvider>
    </QueryClientProvider>,
  );

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });

/** The one request the form made: its path and body. */
const sent = async (): Promise<[string, unknown]> => {
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  return [post.mock.calls[0][0], post.mock.calls[0][1]];
};

// RewardsConverter.maxConvertible: reserve × 1e18 ÷ rate, rounded down
const maxConvertible = (reserve: bigint, rate: bigint): bigint => (reserve * E18) / rate;

afterEach(() => {
  cleanup();
  post.mockClear();
});

// Values a number cannot carry: decimals with no binary form, digits past the 15th, integers past 2^53
const EXACT: [typed: string, raw: string][] = [
  ["1", "1000000000000000000"],
  ["0.333333333333333333", "333333333333333333"],
  ["0.1", "100000000000000000"],
  ["0.7", "700000000000000000"],
  ["0.30000000000000004", "300000000000000040"],
  ["0.000000000000000001", "1"],
  ["1.000000000000000001", "1000000000000000001"],
  ["311584735.999999999999068943", "311584735999999999999068943"],
  ["9007199254740993", "9007199254740993000000000000000000"],
  ["9007199254740993.000000000000000001", "9007199254740993000000000000000001"],
  [".5", "500000000000000000"],
  ["2.", "2000000000000000000"],
  ["1.50000000000000000000", "1500000000000000000"],
];

// Values that would have to be cut, or that read two ways
const UNREADABLE = [
  "0.3333333333333333339",
  "0.0000000000000000001",
  "1.0000000000000000001",
  "0,5",
  "1,000.5",
  "1.2.3",
  "1e3",
  "1e-3",
  "0x10",
  " 1",
  "-1",
  "0",
  "0.000",
  "abc",
];

describe("Set Rate input", () => {
  const RATE = "Rate (STRATO per Rewards Point)";

  it.each(EXACT)("sends %s as the rate %s", async (typed, raw) => {
    show(<SetRateForm state={converter()} />);
    type(RATE, typed);
    expect(input(RATE).getAttribute("aria-invalid")).toBe("false");
    fireEvent.click(button("Set Rate"));

    expect(await sent()).toEqual(["/rewards-converter/admin/set-rate", { rate: raw }]);
    await waitFor(() => expect(input(RATE).value).toBe(""));
  });

  it.each(UNREADABLE)("marks %j invalid and sends nothing", (typed) => {
    show(<SetRateForm state={converter()} />);
    type(RATE, typed);

    expect(input(RATE).getAttribute("aria-invalid")).toBe("true");
    expect(button("Set Rate").disabled).toBe(true);
    fireEvent.click(button("Set Rate"));
    expect(post).not.toHaveBeenCalled();
  });
  it("is not marked while empty", () => {
    show(<SetRateForm state={converter()} />);
    expect(input(RATE).getAttribute("aria-invalid")).toBe("false");
    type(RATE, "  ");
    expect(input(RATE).getAttribute("aria-invalid")).toBe("false");
  });
});

describe("Fund Reserve input, as a STRATO amount", () => {
  const AMOUNT = "Amount (STRATO)";

  const showFunding = async (balance: bigint) => {
    chain.state = converter();
    chain.account = accountWith(balance);
    show(<FundReserveForm state={converter()} stats={statsOf(1000n * E18)} />);
    await screen.findByText(/^Your balance/);
  };

  it.each(EXACT)("sends %s as the amount %s", async (typed, raw) => {
    await showFunding(10n ** 40n);
    type(AMOUNT, typed);
    expect(input(AMOUNT).getAttribute("aria-invalid")).toBe("false");
    fireEvent.click(button("Fund Reserve"));

    expect(await sent()).toEqual(["/rewards-converter/admin/fund-reserve", { amount: raw }]);
  });

  it.each(UNREADABLE)("marks %j invalid and sends nothing", async (typed) => {
    await showFunding(10n ** 40n);
    type(AMOUNT, typed);

    expect(input(AMOUNT).getAttribute("aria-invalid")).toBe("true");
    expect(button("Fund Reserve").disabled).toBe(true);
    fireEvent.click(button("Fund Reserve"));
    expect(post).not.toHaveBeenCalled();
  });

  it("sends the whole balance to its last unit", async () => {
    await showFunding(1000000000000000000001n);
    type(AMOUNT, "1000.000000000000000001");
    expect(input(AMOUNT).getAttribute("aria-invalid")).toBe("false");
    fireEvent.click(button("Fund Reserve"));

    expect(await sent()).toEqual(["/rewards-converter/admin/fund-reserve", { amount: "1000000000000000000001" }]);
  });

  it("blocks an amount one unit above the balance", async () => {
    await showFunding(1000000000000000000001n);
    type(AMOUNT, "1000.000000000000000002");

    expect(input(AMOUNT).getAttribute("aria-invalid")).toBe("true");
    expect(button("Fund Reserve").disabled).toBe(true);
  });

  it("reads the amount at the token's own decimals", async () => {
    chain.state = converter();
    chain.account = accountWith(10n ** 40n);
    const sixDecimals = converter({ stratoToken: { ...STRATO, decimals: 6 } });
    show(<FundReserveForm state={sixDecimals} stats={statsOf(1000n * E18)} />);
    await screen.findByText(/^Your balance/);

    // A seventh decimal is below the token's smallest unit
    type(AMOUNT, "1.1234567");
    expect(button("Fund Reserve").disabled).toBe(true);

    type(AMOUNT, "1.123456");
    fireEvent.click(button("Fund Reserve"));
    expect(await sent()).toEqual(["/rewards-converter/admin/fund-reserve", { amount: "1123456" }]);
  });
});

describe("Fund Reserve input, as a coverage", () => {
  const COVERAGE = "Coverage of outstanding supply (%)";

  const showCoverage = async ({ supply, rate, reserve = 0n, balance = 10n ** 40n }: {
    supply: bigint;
    rate: bigint;
    reserve?: bigint;
    balance?: bigint;
  }) => {
    const state = converter({ rate: rate.toString(), reserve: reserve.toString() });
    chain.state = state;
    chain.account = accountWith(balance);
    show(<FundReserveForm state={state} stats={statsOf(supply)} />);
    await screen.findByText(/^Your balance/);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Coverage" }), { button: 0 });
  };

  /** The line under the input, without thousands separators. */
  const note = () => screen.getByText(/^(Sends \d|Nothing to send)/).textContent?.replace(/,/g, "");

  it("sends the amount that reaches the coverage when supply and rate do not divide evenly", async () => {
    const supply = 580827941454712398160809626n;
    const rate = 333333333333333333n;
    await showCoverage({ supply, rate });
    type(COVERAGE, "12.5");

    expect(note()).toBe("Sends 24201164.22727 STRATO");
    fireEvent.click(button("Fund Reserve"));
    expect(await sent()).toEqual(["/rewards-converter/admin/fund-reserve", { amount: "24201164227279683232499238" }]);

    // On chain that reserve covers 12.5% of the supply, and one unit less does not
    const amount = 24201164227279683232499238n;
    expect(maxConvertible(amount, rate) * 1000n >= supply * 125n).toBe(true);
    expect(maxConvertible(amount - 1n, rate) * 1000n >= supply * 125n).toBe(false);
  });

  it("sends an amount for a small fraction of a percent", async () => {
    await showCoverage({ supply: 311584735999900000000000000n, rate: E18 });
    type(COVERAGE, "0.001");

    expect(note()).toBe("Sends 3115.84735 STRATO");
    fireEvent.click(button("Fund Reserve"));
    expect(await sent()).toEqual(["/rewards-converter/admin/fund-reserve", { amount: "3115847359999000000000" }]);
  });

  it("sends only what the reserve lacks, down to one unit, and shows that unit", async () => {
    await showCoverage({ supply: 1000n * E18, rate: E18, reserve: 400n * E18 - 1n });
    type(COVERAGE, "40");

    expect(note()).toBe("Sends 0.000000000000000001 STRATO");
    fireEvent.click(button("Fund Reserve"));
    expect(await sent()).toEqual(["/rewards-converter/admin/fund-reserve", { amount: "1" }]);
  });

  it("sends nothing when the reserve already covers it", async () => {
    await showCoverage({ supply: 1000n * E18, rate: E18, reserve: 400n * E18 });
    type(COVERAGE, "40");

    expect(note()).toBe("Nothing to send: the reserve already covers this.");
    expect(button("Fund Reserve").disabled).toBe(true);
  });

  it("takes a coverage above 100% and digits down to the 18th place", async () => {
    await showCoverage({ supply: 1000n * E18, rate: E18 / 2n });
    type(COVERAGE, "150.000000000000000001");

    // 150.000000000000000001% of 1000 at 0.5: 750 and 5 units, the half unit rounded up
    expect(note()).toBe("Sends 750.000000000000000005 STRATO");
    fireEvent.click(button("Fund Reserve"));
    expect(await sent()).toEqual(["/rewards-converter/admin/fund-reserve", { amount: "750000000000000000005" }]);
  });

  it("blocks a coverage that costs more than the balance", async () => {
    await showCoverage({ supply: 1000n * E18, rate: E18, balance: 400n * E18 - 1n });
    type(COVERAGE, "40");

    expect(input(COVERAGE).getAttribute("aria-invalid")).toBe("true");
    expect(button("Fund Reserve").disabled).toBe(true);
  });

  it.each(UNREADABLE)("marks %j invalid and sends nothing", async (typed) => {
    await showCoverage({ supply: 1000n * E18, rate: E18 });
    type(COVERAGE, typed);

    expect(input(COVERAGE).getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText(/^(Sends \d|Nothing to send)/)).toBeNull();
    expect(button("Fund Reserve").disabled).toBe(true);
    fireEvent.click(button("Fund Reserve"));
    expect(post).not.toHaveBeenCalled();
  });
});

describe("Withdraw Reserve amount input", () => {
  const AMOUNT = "Amount (STRATO)";

  const showWithdrawal = (reserve: bigint) => {
    show(<WithdrawReserveForm state={converter({ reserve: reserve.toString() })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Withdraw Reserve.+/ }));
    type("Recipient Address", USER);
  };

  it.each(EXACT)("sends %s as the amount %s", async (typed, raw) => {
    showWithdrawal(10n ** 40n);
    type(AMOUNT, typed);
    fireEvent.click(button("Withdraw Reserve"));

    expect(await sent()).toEqual(["/rewards-converter/admin/withdraw-reserve", { to: USER, amount: raw }]);
  });

  it.each(UNREADABLE)("sends nothing for %j", (typed) => {
    showWithdrawal(10n ** 40n);
    type(AMOUNT, typed);

    expect(button("Withdraw Reserve").disabled).toBe(true);
    fireEvent.click(button("Withdraw Reserve"));
    expect(post).not.toHaveBeenCalled();
  });

  it("withdraws the whole reserve to its last unit, and not one unit more", async () => {
    showWithdrawal(1000000000000000000001n);
    type(AMOUNT, "1000.000000000000000002");
    expect(button("Withdraw Reserve").disabled).toBe(true);

    type(AMOUNT, "1000.000000000000000001");
    fireEvent.click(button("Withdraw Reserve"));
    expect(await sent()).toEqual([
      "/rewards-converter/admin/withdraw-reserve",
      { to: USER, amount: "1000000000000000000001" },
    ]);
  });
});
