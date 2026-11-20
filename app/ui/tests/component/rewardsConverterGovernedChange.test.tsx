// @vitest-environment jsdom
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GovernedCallResult, RewardsConverterInfo } from "@strato/shared-types";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * These tests follow a governed call from the Set Rate form and the pause toggle through its vote: the call
 * is submitted, the control waits, and a state refresh that shows the change ends the wait. Only the HTTP
 * client and the signed-in account are replaced. A state refresh is a re-render with the new state.
 */

const VOTE_HASH = "ab".repeat(32);
const ISSUE = "cd".repeat(32);
const EXECUTION_HASH = "ef".repeat(32);
const VOTED: GovernedCallResult = { status: "Success", hash: VOTE_HASH, issueId: ISSUE, executed: false };
const EXECUTED: GovernedCallResult = { status: "Success", hash: VOTE_HASH, issueId: null, executed: true };

const post = vi.hoisted(() => vi.fn());
// The transaction that executed the issue: null until the indexer has it
const chain = vi.hoisted(() => ({ executionHash: null as string | null }));

vi.mock("@/lib/axios", () => ({
  api: {
    post,
    get: vi.fn(async (path: string) => ({
      data: path.endsWith("/issue-execution") ? { hash: chain.executionHash } : {},
    })),
  },
}));
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({ isLoggedIn: true, userAddress: "3".repeat(40) }),
}));
vi.mock("@/context/UserTokensContext", () => ({
  useUserTokens: () => ({ fetchTokens: async () => undefined }),
}));

import PauseToggle from "@/components/admin/rewards-converter/PauseToggle";
import SetRateForm from "@/components/admin/rewards-converter/SetRateForm";

const converter = (rate: string): RewardsConverterInfo => ({
  configured: true,
  address: "1".repeat(40),
  rewardsToken: { address: "4".repeat(40), symbol: "CATA", decimals: 18 },
  stratoToken: { address: "2".repeat(40), symbol: "STRATO", decimals: 18 },
  rate,
  paused: false,
  reserve: "0",
  maxConvertible: "0",
});

/** Renders a control and returns the way to show it again after a state refresh. */
const show = (control: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (shown: ReactElement) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>{shown}</TooltipProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(wrap(control));
  return (refreshed: ReactElement) => rerender(wrap(refreshed));
};

const note = () => screen.getByRole("status").textContent;

afterEach(() => {
  cleanup();
  post.mockReset();
  chain.executionHash = null;
});

describe("Set Rate, through its vote", () => {
  const OLD_RATE = "1000000000000000000";
  const NEW_RATE = "500000000000000000";
  const rateInput = () => screen.getByLabelText("Rate (STRATO per Rewards Point)") as HTMLInputElement;
  const rateButton = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

  const submit = (typed: string, result: GovernedCallResult) => {
    post.mockResolvedValue({ data: result });
    const refresh = show(<SetRateForm state={converter(OLD_RATE)} />);
    fireEvent.change(rateInput(), { target: { value: typed } });
    fireEvent.click(rateButton("Set Rate"));
    return refresh;
  };

  it("holds what was typed, disabled, while the vote is open", async () => {
    const refresh = submit("0.50", VOTED);

    await waitFor(() => expect(rateButton("Setting Rate...").disabled).toBe(true));
    expect(rateInput().value).toBe("0.50");
    expect(rateInput().disabled).toBe(true);
    expect(note()).toBe("Vote submitted · issue cdcdcd...cdcd · waiting on vote");

    // A refresh that still shows the old rate, or a rate some other vote set, does not end the wait
    refresh(<SetRateForm state={converter(OLD_RATE)} />);
    refresh(<SetRateForm state={converter("2000000000000000000")} />);
    expect(rateButton("Setting Rate...").disabled).toBe(true);
    expect(rateInput().value).toBe("0.50");
  });

  it("shows the executing transaction and starts over once the state shows the new rate", async () => {
    const refresh = submit("0.50", VOTED);
    await waitFor(() => rateButton("Setting Rate..."));

    chain.executionHash = EXECUTION_HASH;
    refresh(<SetRateForm state={converter(NEW_RATE)} />);

    expect(rateInput().value).toBe("");
    expect(rateInput().disabled).toBe(false);
    rateButton("Set Rate");
    // The issue stands in until the lookup returns the transaction another admin's vote sent
    expect(note()).toBe("Executed: issue cdcdcd...cdcd");
    screen.getByRole("button", { name: "Copy issue ID" });
    await waitFor(() => expect(note()).toBe("Executed: efefef...efef"));
    screen.getByRole("button", { name: "Copy transaction ID" });

    // The form takes the next rate
    fireEvent.change(rateInput(), { target: { value: "0.25" } });
    expect(rateButton("Set Rate").disabled).toBe(false);
  });

  it("starts over at once when the call executes without a wait", async () => {
    submit("0.50", EXECUTED);

    await waitFor(() => expect(note()).toBe("Executed: ababab...abab"));
    expect(rateInput().value).toBe("");
    expect(rateInput().disabled).toBe(false);
    rateButton("Set Rate");
  });

  it("locks the input while the call is being submitted", async () => {
    let respond: (response: { data: GovernedCallResult }) => void = () => undefined;
    post.mockReturnValue(new Promise((resolve) => (respond = resolve)));
    show(<SetRateForm state={converter(OLD_RATE)} />);
    fireEvent.change(rateInput(), { target: { value: "0.50" } });
    fireEvent.click(rateButton("Set Rate"));

    await waitFor(() => expect(rateButton("Submitting...").disabled).toBe(true));
    expect(rateInput().value).toBe("0.50");
    expect(rateInput().disabled).toBe(true);

    respond({ data: VOTED });
    await waitFor(() => rateButton("Setting Rate..."));
  });
});

describe("Pause toggle, through its vote", () => {
  const toggle = () => screen.getByRole("switch") as HTMLButtonElement;

  it("waits on the vote, then shows the new position and the executing transaction", async () => {
    post.mockResolvedValue({ data: VOTED });
    const refresh = show(<PauseToggle paused={false} />);
    fireEvent.click(toggle());

    await waitFor(() => screen.getByText("Pausing"));
    expect(post.mock.calls[0][0]).toBe("/rewards-converter/admin/pause");
    expect(toggle().disabled).toBe(true);
    expect(note()).toBe("Vote submitted · issue cdcdcd...cdcd · waiting on vote");

    chain.executionHash = EXECUTION_HASH;
    refresh(<PauseToggle paused />);

    screen.getByText("Paused");
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(toggle().disabled).toBe(false);
    await waitFor(() => expect(note()).toBe("Executed: efefef...efef"));
  });

  it("shows the new position at once when the call executes without a wait", async () => {
    post.mockResolvedValue({ data: EXECUTED });
    show(<PauseToggle paused={false} />);
    fireEvent.click(toggle());

    await waitFor(() => screen.getByText("Paused"));
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(note()).toBe("Executed: ababab...abab");
  });
});
