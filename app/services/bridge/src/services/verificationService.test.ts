import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import type { DepositInfo } from "../types";

for (const name of [
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_PRIVATE_KEY",
]) {
  process.env[name] ||= "test";
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TRANSFER_EVENT_SIGNATURE = ethers.id("Transfer(address,address,uint256)");
const verificationService = import("./verificationService");

const chainId = 11155111;
const externalToken = "0x1111111111111111111111111111111111111111";
const depositRouter = "0x2222222222222222222222222222222222222222";
const custodyAddress = "0x3333333333333333333333333333333333333333";
const sender = "0x4444444444444444444444444444444444444444";
const amount = 100n;

const deposit = (overrides: Partial<DepositInfo> = {}): DepositInfo => ({
  bridgeStatus: "1",
  externalSender: sender,
  externalToken,
  requestedAt: "1",
  stratoRecipient: sender,
  stratoToken: "0x5555555555555555555555555555555555555555",
  stratoTokenAmount: amount.toString(),
  timestamp: "1",
  externalChainId: chainId,
  externalTxHash: "0xabc",
  externalDecimals: 18,
  depositRouter,
  custodyAddress,
  ...overrides,
});

test("verifies an ERC-20 transfer to the configured vault custody address", async () => {
  const { validateDeposit, verifyErc20Deposit } = await verificationService;
  const context = validateDeposit(deposit(), chainId);
  assert(!(context instanceof Error));

  const receipt = {
    logs: [
      {
        address: externalToken,
        topics: [
          TRANSFER_EVENT_SIGNATURE,
          ethers.zeroPadValue(sender, 32),
          ethers.zeroPadValue(custodyAddress, 32),
        ],
        data: ethers.zeroPadValue(ethers.toBeHex(amount), 32),
      },
    ],
  };

  assert.equal(verifyErc20Deposit(receipt, context), null);
});

test("rejects an ERC-20 transfer to a different custody address", async () => {
  const { validateDeposit, verifyErc20Deposit } = await verificationService;
  const context = validateDeposit(deposit(), chainId);
  assert(!(context instanceof Error));

  const receipt = {
    logs: [
      {
        address: externalToken,
        topics: [
          TRANSFER_EVENT_SIGNATURE,
          ethers.zeroPadValue(sender, 32),
          ethers.zeroPadValue(sender, 32),
        ],
        data: ethers.zeroPadValue(ethers.toBeHex(amount), 32),
      },
    ],
  };

  assert.match(
    verifyErc20Deposit(receipt, context)?.message || "",
    /No ERC20 Transfer to custody/,
  );
});

test("verifies the DepositRouter internal ETH transfer to vault custody", async () => {
  const { validateDeposit, verifyEthDeposit } = await verificationService;
  const context = validateDeposit(
    deposit({ externalToken: ZERO_ADDRESS }),
    chainId,
  );
  assert(!(context instanceof Error));

  const receipt = { to: depositRouter };
  const traces = [
    {
      type: "call",
      action: {
        to: custodyAddress,
        value: ethers.toBeHex(amount),
      },
    },
  ];

  assert.equal(verifyEthDeposit(receipt, traces, context), null);
});

test("fails closed when custody is missing from chain configuration", async () => {
  const { validateDeposit } = await verificationService;
  const result = validateDeposit(deposit({ custodyAddress: "" }), chainId);
  assert(result instanceof Error);
  assert.match(result.message, /Custody address not configured/);
});
