import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { parseEther } from "ethers";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import EarnStaking from "@/pages/EarnStaking";
import { api } from "@/lib/axios";

vi.mock("@/lib/axios", () => ({ api: { get: vi.fn() } }));
vi.mock("@/context/UserContext", () => ({ useUser: () => ({ isLoggedIn: true, userAddress: "operator" }) }));
vi.mock("@/context/EarnContext", () => ({ useEarnContext: () => ({ tokenApys: [] }) }));
vi.mock("@/context/TokenContext", () => ({
  useTokenContext: () => ({ fetchUsdstBalance: vi.fn(), feeQuote: { vouchers: 10, feeWei: "0", balanceWei: "0" } }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("wagmi", () => ({ useAccount: () => ({ isConnected: false }) }));
vi.mock("@/components/dashboard/DashboardHeader", () => ({ default: () => null }));
vi.mock("@/components/dashboard/DashboardSidebar", () => ({ default: () => null }));
vi.mock("@/components/dashboard/MobileBottomNav", () => ({ default: () => null }));

afterEach(cleanup);

it.each(["v1", "v2"])("shows the operator's bonded stake and exact rewards on %s", async (contractVersion) => {
  const owned = {
    name: "Owned seat", address: "seat", operator: "operator", active: true,
    selfBond: parseEther("10000").toString(), userStake: "0", pendingRewards: "1",
    operatorPendingRewards: parseEther("63.771377327521498918").toString(),
  };
  const other = {
    ...owned, name: "Other seat", address: "other-seat", operator: "other-operator",
    selfBond: parseEther("5000").toString(), userStake: parseEther("34.5").toString(), pendingRewards: "0",
  };
  vi.mocked(api.get).mockResolvedValue({ data: {
    contractVersion, isOperator: true, operatorAddress: contractVersion === "v1" ? owned.operator : owned.address,
    operatedValidators: [owned.address], validators: [owned, other], userTotalStake: other.userStake,
    operatorClaimableRewards: owned.operatorPendingRewards, unbondingRequests: [],
  } });
  window.scrollTo = vi.fn();
  render(<MemoryRouter><EarnStaking /></MemoryRouter>);

  expect(await screen.findByText("10,034.5 STRATO")).toBeTruthy();
  const row = screen.getByRole("row", { name: /Owned seat/ });
  expect(within(row).getByText("10,000")).toBeTruthy();
  expect(within(row).getByText("0.000000000000000001")).toBeTruthy();
  expect(screen.getByText("0.000000000000000001 STRATO", { selector: "p.font-semibold" })).toBeTruthy();
  expect(within(row).getByRole<HTMLButtonElement>("button", { name: "Unstake" }).disabled).toBe(true);
  const otherRow = screen.getByRole("row", { name: /Other seat/ });
  expect(within(otherRow).getByText("34.5")).toBeTruthy();
  expect(screen.getByText("63.771377327521498918 STRATO")).toBeTruthy();
});

it.each([
  ["0", "2378845471274302262", "2.378845471274302262"],
  ["1000000000000000000", "2378845471274302262", "3.378845471274302262"],
  ["1000000000000000000", undefined, "1"],
])("includes legacy credits %s and scheduled emissions %s in total block rewards", async (legacy, emitted, total) => {
  vi.mocked(api.get).mockResolvedValue({ data: {
    contractVersion: "v2", validatorSetDeployed: false, validators: [], unbondingRequests: [],
    totalRewardsCredited: legacy, totalEmitted: emitted,
  } });
  window.scrollTo = vi.fn();
  render(<MemoryRouter><EarnStaking /></MemoryRouter>);

  expect(await screen.findByText(`${total} STRATO credited to date`, { exact: false })).toBeTruthy();
});

it("lists every validator by total stake and re-sorts from the column headers", async () => {
  const validators = Array.from({ length: 12 }, (_, i) => ({
    name: `Seat ${i}`, address: `seat-${i}`, operator: `operator-${i}`, active: true,
    totalStake: parseEther(String(i + 1)).toString(), commissionBps: String(((i * 5) % 12) * 100),
  }));
  vi.mocked(api.get).mockResolvedValue({ data: { contractVersion: "v2", validators, unbondingRequests: [] } });
  window.scrollTo = vi.fn();
  render(<MemoryRouter><EarnStaking /></MemoryRouter>);

  const order = () => screen.getAllByRole("row").slice(1).map((row) => row.textContent?.match(/Seat \d+/)?.[0]);
  await screen.findByRole("row", { name: /Seat 0/ });
  expect(order()).toEqual(validators.map((validator) => validator.name).reverse());

  const commission = screen.getByRole("button", { name: /Commission/ });
  fireEvent.click(commission);
  expect(order()[0]).toBe("Seat 7");
  fireEvent.click(commission);
  expect(order()[0]).toBe("Seat 0");
});
