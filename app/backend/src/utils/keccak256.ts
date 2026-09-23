// Ethereum keccak256 (the original Keccak padding, not NIST SHA3-256, which Node's
// crypto module ships). The backend has no hashing dependency that provides it, and the
// few call sites hash short messages, so a compact BigInt-lane implementation is enough.

const MASK_64 = (1n << 64n) - 1n;

const ROUND_CONSTANTS: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets indexed by lane position x + 5y.
const ROTATIONS: number[] = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

const rotl = (value: bigint, shift: number): bigint =>
  shift === 0 ? value : ((value << BigInt(shift)) | (value >> BigInt(64 - shift))) & MASK_64;

const keccakF1600 = (state: bigint[]): void => {
  const c = new Array<bigint>(5);
  const b = new Array<bigint>(25);

  for (const rc of ROUND_CONSTANTS) {
    // theta
    for (let x = 0; x < 5; x++) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) state[x + y] ^= d;
    }
    // rho + pi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], ROTATIONS[x + 5 * y]);
      }
    }
    // chi
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        state[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK_64 & b[((x + 2) % 5) + y]);
      }
    }
    // iota
    state[0] ^= rc;
  }
};

const RATE_BYTES = 136; // 1600 - 2 * 256 bits

export const keccak256 = (input: Uint8Array): Buffer => {
  const padded = new Uint8Array(Math.floor(input.length / RATE_BYTES + 1) * RATE_BYTES);
  padded.set(input);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  const state = new Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane++) {
      let word = 0n;
      for (let i = 7; i >= 0; i--) {
        word = (word << 8n) | BigInt(padded[offset + lane * 8 + i]);
      }
      state[lane] ^= word;
    }
    keccakF1600(state);
  }

  const out = Buffer.alloc(32);
  for (let lane = 0; lane < 4; lane++) {
    let word = state[lane];
    for (let i = 0; i < 8; i++) {
      out[lane * 8 + i] = Number(word & 0xffn);
      word >>= 8n;
    }
  }
  return out;
};
