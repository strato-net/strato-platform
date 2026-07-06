// Keystore-at-rest encryption: AES-256-GCM with a key derived from the user's
// password via PBKDF2-SHA256. The encrypted blob is what gets persisted to
// chrome.storage.local; plaintext only ever exists in service-worker memory
// while the wallet is unlocked.

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBlob {
  /** base64 */ salt: string;
  /** base64 */ iv: string;
  /** base64 */ ciphertext: string;
  iterations: number;
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

// Copy into a fresh ArrayBuffer-backed view so the Web Crypto BufferSource type
// is satisfied (TS's typed-array generics otherwise widen to ArrayBufferLike).
function buf(u: Uint8Array): ArrayBuffer {
  return u.slice().buffer;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    buf(new TextEncoder().encode(password)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: buf(salt), iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJson(
  password: string,
  data: unknown
): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buf(iv) },
    key,
    buf(plaintext)
  );
  return {
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(ciphertext),
    iterations: PBKDF2_ITERATIONS,
  };
}

export async function decryptJson<T>(
  password: string,
  blob: EncryptedBlob
): Promise<T> {
  const key = await deriveKey(
    password,
    fromB64(blob.salt),
    blob.iterations ?? PBKDF2_ITERATIONS
  );
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf(fromB64(blob.iv)) },
      key,
      buf(fromB64(blob.ciphertext))
    );
  } catch {
    throw new Error("Incorrect password");
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
