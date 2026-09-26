/**
 * Keep a contract deploy from halting the chain.
 *
 * WHY THIS EXISTS. On 2026-09-18 helium stopped at block 595971. Two
 * `createContract("MercataBridge", <~655 KB of flattened Solidity>)`
 * transactions landed in the same block, vm-runner produced the block's
 * `RanBlock` index event to Kafka, the broker rejected it as too large, and the
 * uncaught exception took vm-runner down. `convoke` is fail-fast, so it then
 * tore every container off all four validators. A restart replayed the same
 * block and died the same way.
 *
 * Neither deploy was individually unreasonable -- each was well inside the
 * node's own `txSizeLimit`. What broke it was two of them SHARING A BLOCK, and
 * nothing anywhere refused that. The node accepts per-transaction sizes; the
 * fatal limit applies to a per-block aggregate that no submitter can see.
 *
 * So this guards the two things a submitter actually controls:
 *
 *   1. A hard per-source cap, so one deploy can never be large enough to
 *      breach the limit on its own.
 *   2. A lock, so two large deploys cannot be in flight at once and therefore
 *      cannot land in the same block. This is the part that would have
 *      prevented the halt -- the cap alone would not have.
 *
 * NOT A SUBSTITUTE FOR THE NODE-SIDE FIX. A guard in a deploy script only binds
 * callers who use it; anyone submitting through bloc or the JSON-RPC directly
 * walks straight past it. The durable fixes are in strato/: vm-runner not dying
 * on a rejected index event, and the broker limit paired with milena's fetch
 * buffer. This exists so the repo's own tooling stops being the thing that
 * triggers it.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * The broker's configured `message.max.bytes`.
 *
 * MUST TRACK THE DEPLOYED BROKER CONFIG. Set in the generated compose from
 * strato/libs/composable-monads/kafka-monad/src/Control/Monad/Composable/Kafka/DockerConfig.hs.
 * It was 2,500,000 during the halt and was raised to 8,000,000 in the fix,
 * alongside milena's fetch buffer (4 MiB -> 16 MiB). The two have to move as a
 * pair: milena pins Fetch to API v0 (Protocol.hs:687) with defaultMaxBytes
 * (Kafka.hs:172), and pre-KIP-74 a broker returns an EMPTY set rather than an
 * error for a record above the fetch max_bytes -- so a broker limit above that
 * buffer trades a loud crash for a silently wedged consumer.
 */
const BROKER_MESSAGE_MAX_BYTES = Number(
  process.env.BROKER_MESSAGE_MAX_BYTES || 8000000
);

/**
 * How much of the configured limit a record can actually use.
 *
 * THE CONFIGURED LIMIT IS NOT THE CEILING. Measured from the halt: the RanBlock
 * for block 595971 is 1,313,462 bytes on disk, and the broker refused it while
 * configured at 2,500,000 -- then accepted the same record at 8,000,000. Both
 * observations fit a ceiling of exactly limit/2:
 *
 *     L=2,500,000 -> ceiling 1,250,000 -> 1,313,462 REFUSED  (5% over)
 *     L=8,000,000 -> ceiling 4,000,000 -> 1,313,462 accepted
 *
 * That 5% overshoot is why the ratio looks like an inexplicable 1.9x rather
 * than a clean 2x. A factor of two is what you would expect if the size is
 * counted twice while the broker up-converts milena's magic-byte-0 records to
 * the on-disk v2 format (Producer.hs:107 sends magic 0; segments hold magic 2),
 * since conversion sets messageSizeMaybeChanged and forces a re-check.
 *
 * STILL A HYPOTHESIS. It fits both data points and the mechanism is plausible,
 * but nobody has produced a straddling record to confirm it, so the margin
 * below is deliberately generous.
 */
const EFFECTIVE_CEILING_DIVISOR = Number(
  process.env.KAFKA_EFFECTIVE_CEILING_DIVISOR || 2
);

/**
 * Extra margin, because the divisor above is inferred rather than proven.
 *
 * DO NOT TIGHTEN THIS on the strength of the halt observations. An attempt to
 * pin the boundary directly was confounded: at any limit low enough to refuse
 * the RanBlock, the second record above fails first and kills the process
 * before the RanBlock is reached. "L/2" and "0.45L" both fit everything seen
 * (refused at 2,500,000 and at 2,626,000, accepted at 8,000,000), so the
 * uncertainty this covers is still real. Pinning it needs a synthetic producer
 * against a throwaway broker, not another observation of this block.
 */
const SAFETY_MARGIN = 1.5;

/**
 * What a block's RanBlock event costs beyond the source bytes in it.
 *
 * Measured: for block 595971 the RanBlock is 1,313,462 B against 1,304,198 B of
 * raw source (two 652,099-byte deploys), i.e. source + ~9.3 KB. A single-deploy
 * block gave 657,228 B against 652,099 B. So RanBlock is ~1x the block's total
 * source plus a small constant.
 *
 * NECESSARY BUT NOT PROVEN SUFFICIENT. The RanBlock is the record that was
 * identified in the halt, but it is NOT known to be the binding one. A patched
 * node at a limit low enough to refuse that RanBlock still died on a SECOND
 * oversized record from the same block, on a topic where a rejection is still
 * fatal by design -- `produceVMEvents` (vmevents) or `writeUnseqEvents`
 * (unseqevents), both consensus-relevant and deliberately not best-effort.
 * Nobody has yet established what that record is or how it scales with deploy
 * size, so a budget sized against the RanBlock alone can pass a block that
 * still kills a node.
 *
 * This is why {withLargeDeployLock} is the real protection and this cap is a
 * secondary bound: the lock limits the INPUT, which is knowable, rather than
 * predicting an output whose largest component is still unidentified.
 */
const RANBLOCK_FIXED_OVERHEAD_BYTES = 16 * 1024;

/**
 * How many bytes of Kafka record a byte of source actually costs.
 *
 * THE BINDING RECORD IS NOT THE RanBlock. Measured on node1 after recovery:
 * vmevents offset 1948183 is **2,720,457 bytes**, produced immediately after
 * block 595971 was re-delivered, and later single-deploy blocks carry
 * ~1,362,570 B on the same topic. That record is a `CodeCollectionAdded`
 * VMEvent -- the parsed, typechecked SolidVM CodeCollection, not the source --
 * and it runs about 2.09x the flattened source it came from
 * (1,362,570 / 652,099).
 *
 * It is the record that actually halted helium: a patched node at a limit low
 * enough to refuse the RanBlock died with no "DROPPED index events" line, so
 * the vmevents produce throws first. `produceVMEvents` has no chunking and is
 * deliberately NOT best-effort, because vmevents is consensus-relevant.
 *
 * TWO CONSEQUENCES, both of which this constant exists to encode:
 *   - The budget must be derived from 2.09x, not from the RanBlock's ~1x. The
 *     earlier derivation was roughly half as strict as it needed to be.
 *   - CodeCollectionAdded is emitted PER CODE COLLECTION, not per block, so
 *     {withLargeDeployLock} cannot save an oversized one. Spacing two deploys
 *     produces two ~1.36 MB records instead of one 2.72 MB record -- which is
 *     why spacing worked -- but a single contract around 1.5x MercataBridge's
 *     size yields one indivisible record over the ceiling, and nothing can
 *     split it. For that case this cap is the ONLY protection, which is why it
 *     is a hard throw rather than a warning.
 */
const CODE_COLLECTION_RECORD_FACTOR = 2.09;

/**
 * Most source bytes one block may carry.
 *
 * Per-source in practice, because {withLargeDeployLock} guarantees at most one
 * large deploy is in flight and therefore at most one per block. The cap and
 * the lock are load-bearing together: a single 652 KB deploy was always safe
 * even at the old limit, and what halted the chain was two of them summing
 * inside one RanBlock.
 */
const MAX_BLOCK_SOURCE_BYTES = Math.max(
  0,
  Math.floor(
    (BROKER_MESSAGE_MAX_BYTES / EFFECTIVE_CEILING_DIVISOR / SAFETY_MARGIN
      - RANBLOCK_FIXED_OVERHEAD_BYTES)
      / CODE_COLLECTION_RECORD_FACTOR
  )
);

/**
 * Above this, a deploy takes the lock and waits its turn.
 *
 * Deliberately far below the cap: two sources individually well inside the cap
 * can still breach the ceiling together, which is exactly what happened.
 * Anything big enough to matter in that sum gets serialised.
 */
const SERIALIZE_ABOVE_BYTES = 128 * 1024;

const LOCK_PATH = path.join(os.tmpdir(), 'strato-large-deploy.lock');
const LOCK_STALE_MS = 20 * 60 * 1000;
const LOCK_POLL_MS = 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Refuse a source that could breach the limit on its own.
 *
 * Throws rather than warns. A warning on a deploy script is read after the
 * transaction is already on chain, and by then the block is built.
 */
function assertSourceWithinBudget(contractName, source) {
  const bytes = Buffer.byteLength(
    typeof source === 'string' ? source : String(source),
    'utf8'
  );

  if (bytes > MAX_BLOCK_SOURCE_BYTES) {
    throw new Error(
      `${contractName} source is ${bytes} bytes, over the ${MAX_BLOCK_SOURCE_BYTES}-byte ` +
      `per-block budget (broker message.max.bytes ${BROKER_MESSAGE_MAX_BYTES}, ` +
      `effective ceiling limit/${EFFECTIVE_CEILING_DIVISOR}, ${SAFETY_MARGIN}x margin, ` +
      `less ${RANBLOCK_FIXED_OVERHEAD_BYTES} B of RanBlock overhead).\n` +
      `Deploying it would risk the failure that halted helium at block 595971.\n` +
      `Reduce the flattened collection, or raise the broker limit AND milena's ` +
      `fetch buffer together and set BROKER_MESSAGE_MAX_BYTES to match.`
    );
  }

  return bytes;
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** A lock whose owner is gone, or which has simply been held too long. */
function lockIsStale(lock) {
  if (!lock || typeof lock.pid !== 'number') return true;
  if (Date.now() - (lock.acquiredAt || 0) > LOCK_STALE_MS) return true;
  try {
    process.kill(lock.pid, 0);
    return false;
  } catch {
    return true;
  }
}

/**
 * How long to keep other large deploys out after this one has been submitted.
 *
 * The lock only has to space SUBMISSIONS far enough apart that two large
 * transactions cannot be picked up into the same block. Once that window has
 * passed the lock has done its job, regardless of whether this deploy has been
 * confirmed.
 *
 * Generous on purpose: the cost of over-waiting is a slower rollout, and the
 * cost of under-waiting is a halted chain.
 */
const SUBMISSION_SETTLE_MS = Number(
  process.env.LARGE_DEPLOY_SETTLE_MS || 45000
);

/**
 * Run `fn` with no other large deploy submitted alongside it.
 *
 * Spacing is the whole point: two large transactions submitted at the same
 * moment go into the same block, and their sizes add in the index event that
 * killed the node. Spacing them across blocks leaves each one individually
 * fine -- a single 652 KB deploy produces a ~657 KB RanBlock, which is inside
 * even the old, unpatched ceiling.
 *
 * THE LOCK IS RELEASED AFTER THE SETTLE WINDOW, NOT AFTER `fn` RETURNS, and
 * that is load-bearing rather than an optimisation. A governed contract
 * creation on this chain needs a second admin to vote on the same creation
 * before the first submitter's poll can finish, so holding the lock until `fn`
 * completes would make the second admin wait for the first, and the first wait
 * for the second: a deadlock broken only by the stale-lock timeout. Releasing
 * on the settle window keeps the blocks separate without ever making one
 * deploy wait on the other's confirmation.
 *
 * Small deploys skip the lock -- they cannot contribute meaningfully to the sum
 * and making every deploy serial would slow the whole tool chain for no gain.
 */
async function withLargeDeployLock(label, sourceBytes, fn) {
  if (sourceBytes < SERIALIZE_ABOVE_BYTES) return fn();

  for (;;) {
    try {
      fs.writeFileSync(
        LOCK_PATH,
        JSON.stringify({ pid: process.pid, label, sourceBytes, acquiredAt: Date.now() }),
        { flag: 'wx' }
      );
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;

      const held = readLock();
      if (lockIsStale(held)) {
        console.log(
          `Clearing a stale large-deploy lock (pid ${held && held.pid}, ${LOCK_PATH})`
        );
        try { fs.unlinkSync(LOCK_PATH); } catch { /* raced; retry */ }
        continue;
      }

      console.log(
        `Waiting for another large deploy to land before submitting ${label} ` +
        `(${held.label}, pid ${held.pid}). Two large deploys in one block is ` +
        `what halted helium at 595971.`
      );
      await sleep(LOCK_POLL_MS);
    }
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const held = readLock();
    if (held && held.pid === process.pid) {
      try { fs.unlinkSync(LOCK_PATH); } catch { /* already gone */ }
    }
  };

  // Release once the settle window has passed even if `fn` is still running --
  // see the deadlock note above. `unref` so a pending timer cannot keep the
  // process alive after the deploy is done.
  const timer = setTimeout(release, SUBMISSION_SETTLE_MS);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    return await fn();
  } finally {
    clearTimeout(timer);
    release();
  }
}

module.exports = {
  assertSourceWithinBudget,
  withLargeDeployLock,
  BROKER_MESSAGE_MAX_BYTES,
  EFFECTIVE_CEILING_DIVISOR,
  MAX_BLOCK_SOURCE_BYTES,
  CODE_COLLECTION_RECORD_FACTOR,
  SERIALIZE_ABOVE_BYTES,
  SUBMISSION_SETTLE_MS,
  LOCK_PATH,
};
