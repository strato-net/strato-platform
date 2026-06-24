// KeyringController: account storage, lock/unlock, and the unified signing
// primitive used by both transaction paths.
//
// Accounts come in two kinds, but both expose `signHash(hash) -> {r,s,recovery}`:
//   - local:  HD account (BIP-39 mnemonic, m/44'/60'/0'/0/i) or imported raw
//             private key. Signs locally with viem.
//   - remote: an OAuth/STRATO identity whose key lives in the node vault. Signs
//             by calling POST {vaultUrl}/strato/v2.3/signature. The private key
//             never enters the extension.
//
// The decrypted vault + password live only in service-worker memory while
// unlocked; the persisted form is an AES-GCM EncryptedBlob (vault-crypto.ts).

import { storage } from "wxt/storage";
import {
  type Address,
  type Hex,
  bytesToHex,
  isHex,
} from "viem";
import { sign } from "viem/accounts";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { encryptJson, decryptJson, type EncryptedBlob } from "./vault-crypto";
import { refreshTokens, type OAuthTokens } from "./oauth";

export type AccountKind = "hd" | "imported" | "remote";

export interface AccountMeta {
  address: Address;
  kind: AccountKind;
  label: string;
  /** id of the Hd wallet this account derives from (kind === "hd"). */
  hdWalletId?: string;
  /** HD derivation index within its wallet (kind === "hd"). */
  hdIndex?: number;
  /** vault base URL + username (kind === "remote"). */
  vaultUrl?: string;
  username?: string;
}

/** A backed-up HD wallet (one BIP-39 recovery phrase) — without the secret. */
export interface HdWalletInfo {
  id: string;
  label: string;
}

/** OAuth token bundle for a remote (vault-backed) account, stored encrypted. */
interface StoredToken extends OAuthTokens {
  /** node vault signature endpoint to POST signing hashes to */
  signatureUrl: string;
}

/** A single HD wallet (recovery phrase) — only in memory while unlocked. */
interface HdWallet {
  id: string;
  label: string;
  mnemonic: string;
  nextIndex: number;
}

/** Plaintext vault — only ever held in memory while unlocked. */
interface VaultData {
  /** All HD wallets (recovery phrases). Multiple are supported. */
  hdWallets: HdWallet[];
  /** address -> private key, for derived hd accounts + imported raw keys. */
  privateKeys: Record<string, Hex>;
  /** address -> OAuth tokens, for remote accounts. */
  oauthTokens?: Record<string, StoredToken>;
  /** legacy single-wallet fields (pre multi-HD); migrated on load. */
  mnemonic?: string;
  nextHdIndex?: number;
}

export interface Signature {
  r: Hex;
  s: Hex;
  /** recovery id, 0 or 1 */
  recovery: number;
}

const blobStore = storage.defineItem<EncryptedBlob | null>("local:keystore", {
  fallback: null,
});
const metaStore = storage.defineItem<AccountMeta[]>("local:accounts", {
  fallback: [],
});
const selectedStore = storage.defineItem<Address | null>("local:selectedAccount", {
  fallback: null,
});

// The decrypted vault + password are mirrored here (chrome.storage.session) so an
// unlocked wallet survives MV3 service-worker restarts (e.g. while the OAuth
// window is open). Session storage is in-memory, cleared when the browser closes,
// and not exposed to content scripts — the same trust boundary as SW memory.
const sessionStore = storage.defineItem<{ vault: VaultData; password: string } | null>(
  "session:unlocked",
  { fallback: null }
);

class Keyring {
  private password: string | null = null;
  private vault: VaultData | null = null;

  async isInitialized(): Promise<boolean> {
    return (await blobStore.getValue()) !== null;
  }

  async isUnlocked(): Promise<boolean> {
    return (await this.restore()) !== null;
  }

  async lock(): Promise<void> {
    this.password = null;
    this.vault = null;
    await sessionStore.setValue(null);
  }

  /** Restore the in-memory vault from session storage after a SW restart. */
  private async restore(): Promise<VaultData | null> {
    if (this.vault) return this.vault;
    const saved = await sessionStore.getValue();
    if (saved) {
      this.vault = saved.vault;
      this.password = saved.password;
    }
    return this.vault;
  }

  /** Mirror the current unlocked state into session storage. */
  private async saveSession(): Promise<void> {
    if (this.vault && this.password !== null) {
      await sessionStore.setValue({ vault: this.vault, password: this.password });
    }
  }

  /** Create a brand-new keystore with one HD wallet from a fresh/supplied phrase. */
  async createVault(password: string, mnemonic?: string): Promise<string> {
    let phrase = mnemonic ?? generateMnemonic(wordlist, 128);
    if (mnemonic) {
      phrase = mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
      if (!validateMnemonic(phrase, wordlist)) throw new Error("Invalid recovery phrase");
    }
    const wallet: HdWallet = {
      id: newWalletId(),
      label: "Wallet 1",
      mnemonic: phrase,
      nextIndex: 0,
    };
    this.vault = { hdWallets: [wallet], privateKeys: {} };
    this.password = password;
    await metaStore.setValue([]);
    await selectedStore.setValue(null);
    await this.addHdAccount(wallet.id);
    await this.persist();
    return phrase;
  }

  async unlock(password: string): Promise<void> {
    const blob = await blobStore.getValue();
    if (!blob) throw new Error("No wallet to unlock");
    const data = await decryptJson<VaultData>(password, blob);
    this.vault = migrateVault(data);
    this.password = password;
    await this.migrateMetas();
    await this.persist(); // re-encrypt in migrated shape + mirror to session
  }

  /** Backfill hdWalletId on legacy hd account metadata. */
  private async migrateMetas(): Promise<void> {
    const firstWallet = this.vault?.hdWallets[0];
    if (!firstWallet) return;
    const all = await metaStore.getValue();
    let changed = false;
    for (const m of all) {
      if (m.kind === "hd" && !m.hdWalletId) {
        m.hdWalletId = firstWallet.id;
        changed = true;
      }
    }
    if (changed) await metaStore.setValue(all);
  }

  private async persist(): Promise<void> {
    if (!this.vault || this.password === null) throw new Error("Locked");
    await blobStore.setValue(await encryptJson(this.password, this.vault));
    await this.saveSession();
  }

  /** Get the unlocked vault, restoring from session storage if needed. */
  private async getVault(): Promise<VaultData> {
    const vault = await this.restore();
    if (!vault) throw new Error("Wallet is locked");
    return vault;
  }

  /** Authoritatively verify a password against the stored keystore. */
  private async assertPassword(password: string): Promise<void> {
    const blob = await blobStore.getValue();
    if (!blob) throw new Error("No wallet");
    await decryptJson(password, blob); // throws "Incorrect password" on mismatch
  }

  /** List HD wallets (recovery phrases) without exposing the secrets. */
  async listHdWallets(): Promise<HdWalletInfo[]> {
    return (await this.getVault()).hdWallets.map((w) => ({ id: w.id, label: w.label }));
  }

  /** Reveal a wallet's recovery phrase (password-gated; defaults to first). */
  async revealMnemonic(password: string, walletId?: string): Promise<string> {
    const vault = await this.getVault();
    await this.assertPassword(password);
    const wallet = walletId
      ? vault.hdWallets.find((w) => w.id === walletId)
      : vault.hdWallets[0];
    if (!wallet) throw new Error("HD wallet not found");
    return wallet.mnemonic;
  }

  /** Export an account's private key (password-gated; local accounts only). */
  async exportPrivateKey(address: Address, password: string): Promise<Hex> {
    const vault = await this.getVault();
    await this.assertPassword(password);
    const key = vault.privateKeys[address.toLowerCase()];
    if (!key) throw new Error("This account has no exportable private key");
    return key;
  }

  /** Import a recovery phrase as a NEW HD wallet, returning its first account. */
  async importHdWallet(mnemonic: string, label?: string): Promise<AccountMeta> {
    const vault = await this.getVault();
    const phrase = mnemonic.trim().replace(/\s+/g, " ").toLowerCase();
    if (!validateMnemonic(phrase, wordlist)) throw new Error("Invalid recovery phrase");
    if (vault.hdWallets.some((w) => w.mnemonic === phrase)) {
      throw new Error("This recovery phrase is already imported");
    }
    const wallet: HdWallet = {
      id: newWalletId(),
      label: label ?? `Wallet ${vault.hdWallets.length + 1}`,
      mnemonic: phrase,
      nextIndex: 0,
    };
    vault.hdWallets.push(wallet);
    return this.addHdAccount(wallet.id); // derives account 0 + persists
  }

  /** Create a brand-new HD wallet from a freshly generated phrase. */
  async createHdWallet(label?: string): Promise<AccountMeta> {
    return this.importHdWallet(generateMnemonic(wordlist, 128), label);
  }

  async getAccounts(): Promise<AccountMeta[]> {
    return metaStore.getValue();
  }

  /** Rename an account (label only; no secrets involved). */
  async renameAccount(address: Address, label: string): Promise<AccountMeta> {
    const trimmed = label.trim();
    if (!trimmed) throw new Error("Label cannot be empty");
    const all = await metaStore.getValue();
    const meta = all.find((a) => a.address.toLowerCase() === address.toLowerCase());
    if (!meta) throw new Error("Unknown account");
    meta.label = trimmed;
    await metaStore.setValue(all);
    return meta;
  }

  async getSelectedAddress(): Promise<Address | null> {
    const selected = await selectedStore.getValue();
    if (selected) return selected;
    const accounts = await metaStore.getValue();
    return accounts[0]?.address ?? null;
  }

  async setSelectedAddress(address: Address): Promise<void> {
    await selectedStore.setValue(address);
  }

  /** Derive the next account from an HD wallet (defaults to the first). */
  async addHdAccount(walletId?: string, label?: string): Promise<AccountMeta> {
    const vault = await this.getVault();
    const wallet = walletId
      ? vault.hdWallets.find((w) => w.id === walletId)
      : vault.hdWallets[0];
    if (!wallet) throw new Error("HD wallet not found");

    const index = wallet.nextIndex;
    const account = mnemonicToAccount(wallet.mnemonic, { addressIndex: index });
    const priv = account.getHdKey().privateKey;
    if (!priv) throw new Error("Failed to derive private key");
    const address = account.address;

    vault.privateKeys[address.toLowerCase()] = bytesToHex(priv);
    wallet.nextIndex = index + 1;

    const meta: AccountMeta = {
      address,
      kind: "hd",
      hdWalletId: wallet.id,
      hdIndex: index,
      label: label ?? `Account ${index + 1}`,
    };
    await this.appendMeta(meta);
    await this.persist();
    return meta;
  }

  /** Import a raw private key. */
  async importPrivateKey(privateKey: string, label?: string): Promise<AccountMeta> {
    const vault = await this.getVault();
    const hex = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
    if (!isHex(hex) || hex.length !== 66) throw new Error("Invalid private key");
    const account = privateKeyToAccount(hex);
    const address = account.address;
    if (vault.privateKeys[address.toLowerCase()]) {
      throw new Error("Account already imported");
    }
    vault.privateKeys[address.toLowerCase()] = hex;
    const meta: AccountMeta = {
      address,
      kind: "imported",
      label: label ?? "Imported account",
    };
    await this.appendMeta(meta);
    await this.persist();
    return meta;
  }

  /**
   * Record an OAuth/vault-backed account from a completed login. The key stays in
   * the node vault; we keep the OAuth tokens (encrypted) and sign by calling the
   * node with Authorization: Bearer.
   */
  async addOAuthAccount(
    address: Address,
    tokens: OAuthTokens,
    signatureUrl: string,
    username?: string,
    label?: string
  ): Promise<AccountMeta> {
    const vault = await this.getVault();
    const key = address.toLowerCase();
    vault.oauthTokens = vault.oauthTokens ?? {};
    vault.oauthTokens[key] = { ...tokens, signatureUrl };
    const meta: AccountMeta = {
      address,
      kind: "remote",
      username,
      label: label ?? username ?? "STRATO account",
    };
    await this.appendMeta(meta);
    await this.persist();
    return meta;
  }

  private async appendMeta(meta: AccountMeta): Promise<void> {
    const all = await metaStore.getValue();
    if (all.some((a) => a.address.toLowerCase() === meta.address.toLowerCase())) {
      return;
    }
    all.push(meta);
    await metaStore.setValue(all);
    if (all.length === 1) await selectedStore.setValue(meta.address);
  }

  /**
   * The unified signing primitive. For local accounts signs `hash` with viem;
   * for remote accounts calls the node vault. Returns r/s as 0x-hex (32 bytes)
   * and a recovery id of 0/1 — callers map this onto EIP-155 v or the STRATO
   * v-byte (recovery + 27) as needed.
   */
  /** Return a non-expired token for a remote account, refreshing if needed. */
  private async getFreshToken(address: Address): Promise<StoredToken | null> {
    const vault = await this.getVault();
    const key = address.toLowerCase();
    const token = vault.oauthTokens?.[key];
    if (!token) return null;
    if (token.expiresAt - Date.now() > 60_000) return token;
    // Near/at expiry — refresh and persist.
    const refreshed = await refreshTokens(token);
    const updated: StoredToken = { ...token, ...refreshed };
    vault.oauthTokens![key] = updated;
    await this.persist();
    return updated;
  }

  async signHash(address: Address, hash: Hex): Promise<Signature> {
    const meta = (await metaStore.getValue()).find(
      (a) => a.address.toLowerCase() === address.toLowerCase()
    );
    if (!meta) throw new Error(`Unknown account ${address}`);

    if (meta.kind === "remote") {
      const token = await this.getFreshToken(address);
      if (token) return signViaBearer(token.signatureUrl, token.accessToken, hash);
      // Legacy cookie-based remote account (no stored OAuth tokens).
      if (meta.vaultUrl) return signViaVaultCookie(meta.vaultUrl, hash);
      throw new Error("Remote account has no signer; log in again");
    }

    const vault = await this.getVault();
    const priv = vault.privateKeys[address.toLowerCase()];
    if (!priv) throw new Error("No key for account");
    const sig = await sign({ hash, privateKey: priv });
    return { r: sig.r, s: sig.s, recovery: Number(sig.yParity ?? 0) };
  }
}

function newWalletId(): string {
  return `wallet-${crypto.randomUUID()}`;
}

/** Upgrade a legacy single-mnemonic vault to the multi-HD-wallet shape. */
function migrateVault(data: VaultData): VaultData {
  data.privateKeys = data.privateKeys ?? {};
  if (!data.hdWallets) {
    data.hdWallets = data.mnemonic
      ? [
          {
            id: "wallet-legacy",
            label: "Wallet 1",
            mnemonic: data.mnemonic,
            nextIndex: data.nextHdIndex ?? 0,
          },
        ]
      : [];
  }
  delete data.mnemonic;
  delete data.nextHdIndex;
  return data;
}

function toSignature(sig: { r: string; s: string; v: number | string }): Signature {
  // The vault returns v as a recovery id; normalize 27/28 -> 0/1 just in case.
  const v = Number(sig.v);
  return {
    r: `0x${String(sig.r).replace(/^0x/, "")}` as Hex,
    s: `0x${String(sig.s).replace(/^0x/, "")}` as Hex,
    recovery: v >= 27 ? v - 27 : v,
  };
}

/**
 * Vault signing for OAuth accounts via Bearer token. nginx validates the token
 * and forwards it to the vault, which signs with the user's key. The CSRF guard
 * on this POST is bypassed by an API-client User-Agent set via declarativeNetRequest
 * (see csrf-bypass in the background).
 */
async function signViaBearer(
  signatureUrl: string,
  accessToken: string,
  hash: Hex
): Promise<Signature> {
  const res = await fetch(signatureUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ msgHash: hash.replace(/^0x/, "") }),
  });
  if (!res.ok) throw new Error(`Vault signing failed (${res.status}): ${await res.text()}`);
  return toSignature(await res.json());
}

/** Legacy cookie-session vault signing (same-origin contexts only). */
async function signViaVaultCookie(vaultUrl: string, hash: Hex): Promise<Signature> {
  const res = await fetch(`${vaultUrl.replace(/\/$/, "")}/signature`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msgHash: hash.replace(/^0x/, "") }),
  });
  if (!res.ok) throw new Error(`Vault signing failed: ${res.status}`);
  return toSignature(await res.json());
}

export const keyring = new Keyring();
