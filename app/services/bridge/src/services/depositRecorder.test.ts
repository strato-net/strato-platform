import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import { FunctionInput, WindowDeposit } from "../types";
import { TxPendingError } from "../utils/stratoHelper";
import { canonicalDepositKey } from "./depositEventService";
import {
  createDepositRecorder,
  DepositReadBackError,
  DepositRecorderDeps,
} from "./depositRecorder";

const CHAIN_ID = 1;
const ETH = "0x0000000000000000000000000000000000000000";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDST = "0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
const STRATO_USDC = "0x6aeacaa19c68e53035bf495d15e0a328fc600ba8";
const ETHST = "0x93fb7295859b2d70199e0a4883b7c320cf874e6c";

let nextId = 1;
const deposit = (overrides: Partial<WindowDeposit> = {}): WindowDeposit => {
  const depositId = String(nextId++);
  const externalTxHash = `0x${depositId.padStart(64, "0")}`;
  return {
    kind: "standard",
    externalChainId: CHAIN_ID,
    externalSender: "0x1111111111111111111111111111111111111111",
    externalToken: ETH,
    externalTokenAmount: "1000",
    externalTxHash,
    stratoRecipient: "0x2222222222222222222222222222222222222222",
    targetStratoToken: ETHST,
    action: "0",
    actionToken: ETH,
    minFinalOut: "0",
    depositId,
    depositKey: externalTxHash,
    sharesTransaction: false,
    blockNumber: 100,
    logIndex: 0,
    ...overrides,
  };
};

type Fault = (call: FunctionInput) => Error | undefined;

// A fake MercataBridge with the same idempotency and revert behavior as the contract
const harness = (options: {
  useDepositWindow: boolean;
  disabledRoutes?: Array<[string, string]>;
  fault?: Fault;
  readBackLagPolls?: number;
  neverVisible?: boolean;
}) => {
  const records = new Map<string, number>(); // canonical key -> bridgeStatus (1 INITIATED, 6 QUARANTINED)
  const calls: FunctionInput[] = [];
  const deadLetters: Array<{ key: string; reason: string }> = [];
  const local: number[] = [];
  const onChain: number[] = [];
  let checkpoint = 0;
  let readBackPolls = 0;

  const routeDisabled = (d: { externalToken: string; targetStratoToken: string }) =>
    (options.disabledRoutes ?? []).some(
      ([token, target]) => token === d.externalToken && target === d.targetStratoToken,
    );

  const legacyRecord = (key: string, d: { externalToken: string; targetStratoToken: string }) => {
    if (records.has(canonicalDepositKey(key))) throw new Error("solidity require failed: MB: duplicate deposit");
    if (routeDisabled(d)) throw new Error("solidity require failed: MB: route not enabled");
  };

  const execute = async (input: FunctionInput | FunctionInput[]) => {
    const call = input as FunctionInput;
    calls.push(call);
    const fault = options.fault?.(call);
    if (fault) throw fault;
    const a = call.args;
    switch (call.method) {
      case "recordDepositWindow": {
        a.externalTxHashes.forEach((key: string, i: number) => {
          const canonical = canonicalDepositKey(key);
          if (records.has(canonical)) return;
          const quarantined = routeDisabled({
            externalToken: a.externalTokens[i],
            targetStratoToken: a.targetStratoTokens[i],
          });
          records.set(canonical, quarantined ? 6 : 1);
        });
        if (a.lastProcessedBlock > checkpoint) {
          checkpoint = a.lastProcessedBlock;
          onChain.push(checkpoint);
        }
        break;
      }
      case "depositBatch":
      case "depositBatchWithAction": {
        a.externalTxHashes.forEach((key: string, i: number) =>
          legacyRecord(key, { externalToken: a.externalTokens[i], targetStratoToken: a.targetStratoTokens[i] }),
        );
        a.externalTxHashes.forEach((key: string) => records.set(canonicalDepositKey(key), 1));
        break;
      }
      case "deposit":
      case "depositWithAction":
        legacyRecord(a.externalTxHash, a as any);
        records.set(canonicalDepositKey(a.externalTxHash), 1);
        break;
      default:
        throw new Error(`unexpected method ${call.method}`);
    }
    return { status: "Success" as const, hash: `tx${calls.length}` };
  };

  const deps: DepositRecorderDeps = {
    execute,
    getRecordedDepositKeys: async (_chainId, keys) => {
      readBackPolls++;
      if (options.neverVisible || readBackPolls <= (options.readBackLagPolls ?? 0)) return new Set();
      return new Set(keys.filter((key) => records.has(key)));
    },
    deadLetters: {
      add: async (_chainId, d, reason) => {
        deadLetters.push({ key: d.depositKey, reason });
      },
    },
    commitLocalCheckpoint: async (_chainId, block) => {
      local.push(block);
    },
    commitOnChainCheckpoint: async (_chainId, block) => {
      const fault = options.fault?.({ contractName: "MercataBridge", contractAddress: "", method: "setLastProcessedBlock", args: { block } });
      if (fault) throw fault;
      calls.push({ contractName: "MercataBridge", contractAddress: "", method: "setLastProcessedBlock", args: { block } });
      checkpoint = Math.max(checkpoint, block);
      onChain.push(block);
    },
    bridgeAddress: "1008",
    useDepositWindow: options.useDepositWindow,
    readBackTimeoutMs: options.neverVisible ? 0 : 60_000,
    readBackIntervalMs: 0,
    sleep: async () => undefined,
  };

  return {
    recorder: createDepositRecorder(deps),
    records,
    calls,
    methods: () => calls.map((c) => c.method),
    deadLetters,
    local,
    onChain,
  };
};

const pending = (method: string, predicate: (call: FunctionInput) => boolean = () => true): Fault =>
  (call) => (call.method === method && predicate(call) ? new TxPendingError(["0xdead"]) : undefined);

// ---------------- recordDepositWindow path ----------------

test("window: deposits and checkpoint land in one call, then the local checkpoint moves", async () => {
  const h = harness({ useDepositWindow: true });
  const deposits = [deposit(), deposit()];
  await h.recorder.recordWindow(CHAIN_ID, 500, deposits);

  assert.deepEqual(h.methods(), ["recordDepositWindow"]);
  assert.equal(h.calls[0].args.lastProcessedBlock, 500);
  assert.deepEqual(h.calls[0].args.depositIds, deposits.map((d) => d.depositId));
  assert.deepEqual(h.onChain, [500]);
  assert.deepEqual(h.local, [500]);
});

test("window: a pending recording leaves both checkpoints alone (Sept 15 displacement)", async () => {
  const h = harness({ useDepositWindow: true, fault: pending("recordDepositWindow") });
  await assert.rejects(() => h.recorder.recordWindow(CHAIN_ID, 500, [deposit()]), TxPendingError);

  assert.deepEqual(h.onChain, []);
  assert.deepEqual(h.local, []);
  assert.deepEqual(h.deadLetters, []);
});

test("window: waits for Cirrus to show the deposits before moving the local checkpoint", async () => {
  const h = harness({ useDepositWindow: true, readBackLagPolls: 2 });
  await h.recorder.recordWindow(CHAIN_ID, 500, [deposit()]);
  assert.deepEqual(h.local, [500]);
});

test("window: deposits that never show up keep the local checkpoint where it was", async () => {
  const h = harness({ useDepositWindow: true, neverVisible: true });
  await assert.rejects(
    () => h.recorder.recordWindow(CHAIN_ID, 500, [deposit()]),
    DepositReadBackError,
  );
  assert.deepEqual(h.local, []);
});

test("window: a retired route is quarantined on-chain without holding back the window", async () => {
  const h = harness({ useDepositWindow: true, disabledRoutes: [[USDC, USDST]] });
  const retired = deposit({ externalToken: USDC, targetStratoToken: USDST });
  const eth = [deposit(), deposit()];
  await h.recorder.recordWindow(CHAIN_ID, 500, [retired, ...eth]);

  assert.equal(h.records.get(retired.depositKey), 6);
  eth.forEach((d) => assert.equal(h.records.get(d.depositKey), 1));
  assert.deepEqual(h.deadLetters, []);
  assert.deepEqual(h.local, [500]);
});

test("window: a deposit the contract rejects outright is dead-lettered and the rest recorded", async () => {
  const bad = deposit();
  const good = [deposit(), deposit()];
  const h = harness({
    useDepositWindow: true,
    fault: (call) =>
      call.method === "recordDepositWindow" && call.args.depositIds.includes(bad.depositId)
        ? new Error("solidity require failed: MB: deposit id mismatch")
        : undefined,
  });
  await h.recorder.recordWindow(CHAIN_ID, 500, [good[0], bad, good[1]]);

  assert.deepEqual(h.deadLetters.map((d) => d.key), [bad.depositKey]);
  assert.match(h.deadLetters[0].reason, /deposit id mismatch/);
  good.forEach((d) => assert.equal(h.records.get(d.depositKey), 1));
  // Per-deposit calls leave the checkpoint alone; a final empty window moves it
  assert.deepEqual(
    h.calls.map((c) => [c.args.depositIds.length, c.args.lastProcessedBlock]),
    [[3, 500], [1, 0], [1, 0], [1, 0], [0, 500]],
  );
  assert.deepEqual(h.local, [500]);
});

test("window: a lone rejected deposit is dead-lettered without resending it", async () => {
  const bad = deposit();
  const h = harness({
    useDepositWindow: true,
    fault: (call) =>
      call.method === "recordDepositWindow" && call.args.depositIds.length
        ? new Error("solidity require failed: MB: deposit id reused")
        : undefined,
  });
  await h.recorder.recordWindow(CHAIN_ID, 500, [bad]);

  assert.deepEqual(h.deadLetters.map((d) => d.key), [bad.depositKey]);
  assert.deepEqual(h.calls.map((c) => c.args.depositIds.length), [1, 0]);
  assert.deepEqual(h.local, [500]);
});

test("window: a failure that is not about one deposit stops the window", async () => {
  for (const message of ["solidity require failed: MB: deposits paused", "Connection refused"]) {
    const h = harness({
      useDepositWindow: true,
      fault: (call) => (call.method === "recordDepositWindow" ? new Error(message) : undefined),
    });
    await assert.rejects(() => h.recorder.recordWindow(CHAIN_ID, 500, [deposit(), deposit()]), new RegExp(message));
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.deadLetters, []);
    assert.deepEqual(h.local, []);
  }
});

test("window: an empty window only moves the local checkpoint", async () => {
  const h = harness({ useDepositWindow: true });
  await h.recorder.recordWindow(CHAIN_ID, 500, []);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.local, [500]);
});

test("window: a replayed window is harmless", async () => {
  const h = harness({ useDepositWindow: true });
  const deposits = [deposit(), deposit()];
  await h.recorder.recordWindow(CHAIN_ID, 500, deposits);
  await h.recorder.recordWindow(CHAIN_ID, 500, deposits);
  assert.equal(h.records.size, 2);
  assert.deepEqual(h.local, [500, 500]);
  assert.deepEqual(h.deadLetters, []);
});

test("window: every deposit of a multi-deposit transaction is recorded under its own key", async () => {
  const h = harness({ useDepositWindow: true });
  const hash = `0x${"ab".repeat(32)}`;
  const shared = [
    deposit({ externalTxHash: hash, depositKey: `${hash}#40`, depositId: "40", sharesTransaction: true }),
    deposit({ externalTxHash: hash, depositKey: `${hash}#41`, depositId: "41", sharesTransaction: true }),
  ];
  await h.recorder.recordWindow(CHAIN_ID, 500, shared);

  assert.deepEqual(h.calls[0].args.externalTxHashes, [`${hash}#40`, `${hash}#41`]);
  assert.deepEqual([...h.records.keys()], [`${hash}#40`, `${hash}#41`]);
  assert.deepEqual(h.local, [500]);
});

// ---------------- legacy depositBatch path ----------------

test("legacy: records, reads back, then moves the on-chain and local checkpoints in order", async () => {
  const h = harness({ useDepositWindow: false });
  await h.recorder.recordWindow(CHAIN_ID, 500, [deposit(), deposit()]);

  assert.deepEqual(h.methods(), ["depositBatch", "setLastProcessedBlock"]);
  assert.deepEqual(h.onChain, [500]);
  assert.deepEqual(h.local, [500]);
});

test("legacy: a pending batch never lets either checkpoint move (Sept 15 displacement)", async () => {
  const h = harness({ useDepositWindow: false, fault: pending("depositBatch") });
  await assert.rejects(() => h.recorder.recordWindow(CHAIN_ID, 500, [deposit()]), TxPendingError);

  assert.deepEqual(h.methods(), ["depositBatch"]);
  assert.deepEqual(h.onChain, []);
  assert.deepEqual(h.local, []);
});

test("legacy: a retired route no longer poisons the batch (Sept 15 batch 3a937d)", async () => {
  const h = harness({ useDepositWindow: false, disabledRoutes: [[USDC, USDST]] });
  const retired = deposit({ externalToken: USDC, targetStratoToken: USDST, externalTokenAmount: "4930779" });
  const eth = [deposit(), deposit()];
  await h.recorder.recordWindow(CHAIN_ID, 25982816, [retired, ...eth]);

  assert.deepEqual(h.deadLetters.map((d) => d.key), [retired.depositKey]);
  assert.match(h.deadLetters[0].reason, /route not enabled/);
  eth.forEach((d) => assert.ok(h.records.has(d.depositKey)));
  assert.deepEqual(h.methods(), ["depositBatch", "deposit", "deposit", "deposit", "setLastProcessedBlock"]);
  assert.deepEqual(h.local, [25982816]);
});

test("legacy: a pending item during fallback stops before any checkpoint", async () => {
  const h = harness({
    useDepositWindow: false,
    disabledRoutes: [[USDC, USDST]],
    fault: pending("deposit"),
  });
  await assert.rejects(
    () =>
      h.recorder.recordWindow(CHAIN_ID, 500, [
        deposit({ externalToken: USDC, targetStratoToken: USDST }),
        deposit(),
      ]),
    TxPendingError,
  );
  assert.deepEqual(h.onChain, []);
  assert.deepEqual(h.local, []);
});

test("legacy: already-recorded deposits count as recorded when a window is replayed", async () => {
  const h = harness({ useDepositWindow: false });
  const first = deposit();
  await h.recorder.recordWindow(CHAIN_ID, 400, [first]);
  const second = deposit({ externalToken: USDC, targetStratoToken: STRATO_USDC });
  await h.recorder.recordWindow(CHAIN_ID, 500, [first, second]);

  assert.deepEqual(h.methods(), [
    "depositBatch",
    "setLastProcessedBlock",
    "depositBatch",
    "deposit",
    "deposit",
    "setLastProcessedBlock",
  ]);
  assert.deepEqual(h.deadLetters, []);
  assert.deepEqual(h.local, [400, 500]);
});

test("legacy: a multi-deposit transaction is dead-lettered instead of halting the chain", async () => {
  const h = harness({ useDepositWindow: false });
  const hash = `0x${"cd".repeat(32)}`;
  const shared = [
    deposit({ externalTxHash: hash, depositKey: `${hash}#50`, depositId: "50", sharesTransaction: true }),
    deposit({ externalTxHash: hash, depositKey: `${hash}#51`, depositId: "51", sharesTransaction: true }),
  ];
  const lone = deposit();
  await h.recorder.recordWindow(CHAIN_ID, 500, [...shared, lone]);

  assert.deepEqual(h.deadLetters.map((d) => d.key), [`${hash}#50`, `${hash}#51`]);
  assert.deepEqual(h.calls[0].args.externalTxHashes, [lone.externalTxHash]);
  assert.deepEqual(h.local, [500]);
});

test("legacy: a pending on-chain checkpoint keeps the local checkpoint back", async () => {
  const h = harness({ useDepositWindow: false, fault: pending("setLastProcessedBlock") });
  await assert.rejects(() => h.recorder.recordWindow(CHAIN_ID, 500, [deposit()]), TxPendingError);
  assert.deepEqual(h.local, []);
});

test("legacy: action deposits go through depositBatchWithAction", async () => {
  const h = harness({ useDepositWindow: false });
  const action = deposit({ kind: "action", action: "2", actionToken: "0x5555555555555555555555555555555555555555", minFinalOut: "9" });
  await h.recorder.recordWindow(CHAIN_ID, 500, [deposit(), action]);

  assert.deepEqual(h.methods(), ["depositBatch", "depositBatchWithAction", "setLastProcessedBlock"]);
  assert.deepEqual(h.calls[1].args.actions, ["2"]);
  assert.deepEqual(h.calls[1].args.minFinalOuts, ["9"]);
});

// ---------------- recovery path ----------------

test("recovery records missed deposits and moves no checkpoint (window mode)", async () => {
  const h = harness({ useDepositWindow: true });
  const deposits = [deposit(), deposit()];
  await h.recorder.recordDeposits(CHAIN_ID, deposits);

  assert.deepEqual(h.methods(), ["recordDepositWindow"]);
  assert.equal(h.calls[0].args.lastProcessedBlock, 0);
  deposits.forEach((d) => assert.equal(h.records.get(d.depositKey), 1));
  assert.deepEqual(h.onChain, []);
  assert.deepEqual(h.local, []);
});

test("recovery records missed deposits and moves no checkpoint (legacy mode)", async () => {
  const h = harness({ useDepositWindow: false });
  await h.recorder.recordDeposits(CHAIN_ID, [deposit()]);

  assert.deepEqual(h.methods(), ["depositBatch"]);
  assert.deepEqual(h.onChain, []);
  assert.deepEqual(h.local, []);
});

test("recovery leaves a retired-route deposit dead-lettered, not recorded", async () => {
  const h = harness({ useDepositWindow: false, disabledRoutes: [[USDC, USDST]] });
  const retired = deposit({ externalToken: USDC, targetStratoToken: USDST });
  await h.recorder.recordDeposits(CHAIN_ID, [retired]);

  assert.deepEqual(h.deadLetters.map((d) => d.key), [retired.depositKey]);
  assert.equal(h.records.has(retired.depositKey), false);
  assert.deepEqual(h.onChain, []);
  assert.deepEqual(h.local, []);
});

test("recovery does nothing when every deposit is already recorded", async () => {
  const h = harness({ useDepositWindow: true });
  await h.recorder.recordDeposits(CHAIN_ID, []);
  assert.deepEqual(h.calls, []);
});
