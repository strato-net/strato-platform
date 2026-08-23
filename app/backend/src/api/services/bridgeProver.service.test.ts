import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

// The module reads its URL from the environment at call time, so each test can
// point it somewhere different.
import {
  proverConfigured,
  proveAggregate,
  committeeCommitment,
  proverReady,
} from "./bridgeProver.service";

const PUBKEYS = Array.from({ length: 512 }, (_, i) => `0x${String(i).padStart(96, "0")}`);
const BITS = `0x${"ff".repeat(64)}`;

/** A stand-in proverd. Returns whatever `reply` decides, and records requests. */
async function withProver(
  reply: (path: string, body: any) => { status: number; body: unknown },
  run: (received: Array<{ path: string; body: any }>) => Promise<void>,
) {
  const received: Array<{ path: string; body: any }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      received.push({ path: req.url ?? "", body });
      const out = reply(req.url ?? "", body);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const prev = process.env.BRIDGE_PROVER_URL;
  process.env.BRIDGE_PROVER_URL = `http://127.0.0.1:${port}`;
  try {
    await run(received);
  } finally {
    if (prev === undefined) delete process.env.BRIDGE_PROVER_URL;
    else process.env.BRIDGE_PROVER_URL = prev;
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("proverConfigured is false without a URL", () => {
  const prev = process.env.BRIDGE_PROVER_URL;
  delete process.env.BRIDGE_PROVER_URL;
  try {
    assert.equal(proverConfigured(), false);
  } finally {
    if (prev !== undefined) process.env.BRIDGE_PROVER_URL = prev;
  }
});

test("proveAggregate sends the committee and returns the proof", async () => {
  const proof = { aggregate: "0xaa", commitment: "0x1e80", proof: ["0x1", "0x2"], publicInputs: ["0x3"], signers: 470, elapsedMs: 33719 };
  await withProver(
    () => ({ status: 200, body: proof }),
    async (received) => {
      const res = await proveAggregate(PUBKEYS, BITS);
      assert.equal(received.length, 1);
      assert.equal(received[0].path, "/prove");
      assert.equal(received[0].body.pubkeys.length, 512);
      assert.equal(received[0].body.participationBits, BITS);
      assert.equal(res.commitment, "0x1e80");
      assert.equal(res.signers, 470);
      assert.deepEqual(res.proof, ["0x1", "0x2"]);
    },
  );
});

test("proveAggregate refuses a committee that is not 512 keys", async () => {
  await withProver(
    () => ({ status: 200, body: {} }),
    async (received) => {
      await assert.rejects(() => proveAggregate(PUBKEYS.slice(0, 511), BITS), /512/);
      // Rejected before any request went out.
      assert.equal(received.length, 0);
    },
  );
});

/** A prover that answers but returns nothing usable must not look like success:
 *  the caller falls back to native aggregation on a throw, and would anchor
 *  with a broken tx otherwise. */
test("proveAggregate rejects an empty proof", async () => {
  await withProver(
    () => ({ status: 200, body: { aggregate: "0xaa", proof: [] } }),
    async () => {
      await assert.rejects(() => proveAggregate(PUBKEYS, BITS), /no proof/);
    },
  );
});

test("proveAggregate surfaces a prover error", async () => {
  await withProver(
    () => ({ status: 400, body: { error: "bitfield selects nobody" } }),
    async () => {
      await assert.rejects(() => proveAggregate(PUBKEYS, BITS));
    },
  );
});

test("committeeCommitment returns the digest", async () => {
  await withProver(
    () => ({ status: 200, body: { commitment: "0x1e8042c2" } }),
    async (received) => {
      assert.equal(await committeeCommitment(PUBKEYS), "0x1e8042c2");
      assert.equal(received[0].path, "/commitment");
    },
  );
});

test("proverReady reflects the health endpoint", async () => {
  await withProver(
    () => ({ status: 200, body: { ready: true, constraints: 2322769 } }),
    async () => assert.equal(await proverReady(), true),
  );
  await withProver(
    () => ({ status: 200, body: { ready: false } }),
    async () => assert.equal(await proverReady(), false),
  );
});

/** Health is the one call that must never throw: it is asked precisely when
 *  the prover may be down. */
test("proverReady is false when the prover is unreachable", async () => {
  const prev = process.env.BRIDGE_PROVER_URL;
  process.env.BRIDGE_PROVER_URL = "http://127.0.0.1:1";
  try {
    assert.equal(await proverReady(), false);
  } finally {
    if (prev === undefined) delete process.env.BRIDGE_PROVER_URL;
    else process.env.BRIDGE_PROVER_URL = prev;
  }
});
