import {
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
} from "@aws-sdk/client-kms";
import { createPublicKey } from "node:crypto";
import {
  AbstractSigner,
  computeAddress,
  JsonRpcProvider,
  Provider,
  Signature,
  Transaction,
  TransactionRequest,
  TypedDataEncoder,
  getBytes,
  hashMessage,
  hexlify,
  recoverAddress,
  toBeHex,
} from "ethers";
import { safeChecksum } from "./utils";

interface KmsClient {
  send(command: SignCommand | GetPublicKeyCommand): Promise<any>;
}

export interface AwsKmsConfig {
  address: string;
  keyId: string;
  region: string;
  client?: KmsClient;
}

const CURVE_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;
const clients = new Map<string, KMSClient>();

const getClient = (config: AwsKmsConfig): KmsClient => {
  if (config.client) return config.client;
  const existing = clients.get(config.region);
  if (existing) return existing;
  const client = new KMSClient({ region: config.region });
  clients.set(config.region, client);
  return client;
};

const readDerLength = (
  bytes: Uint8Array,
  offset: number,
): { length: number; next: number } => {
  const first = bytes[offset];
  if (first === undefined) throw new Error("KMS returned malformed DER");
  if (first < 0x80) return { length: first, next: offset + 1 };
  const octets = first & 0x7f;
  if (octets === 0 || octets > 2 || offset + octets >= bytes.length) {
    throw new Error("KMS returned malformed DER");
  }
  let length = 0;
  for (let index = 0; index < octets; index += 1) {
    length = length * 256 + bytes[offset + 1 + index];
  }
  return { length, next: offset + 1 + octets };
};

const readDerInteger = (
  bytes: Uint8Array,
  offset: number,
): { value: bigint; next: number } => {
  if (bytes[offset] !== 0x02) throw new Error("KMS returned malformed DER");
  const { length, next } = readDerLength(bytes, offset + 1);
  const end = next + length;
  if (length === 0 || end > bytes.length || (bytes[next] & 0x80) !== 0) {
    throw new Error("KMS returned malformed DER");
  }
  const valueBytes =
    length > 1 && bytes[next] === 0 ? bytes.slice(next + 1, end) : bytes.slice(next, end);
  if (valueBytes.length > 32) throw new Error("KMS returned oversized ECDSA value");
  const hex = Buffer.from(valueBytes).toString("hex") || "0";
  return { value: BigInt(`0x${hex}`), next: end };
};

export const decodeKmsSignature = (
  der: Uint8Array,
): { r: bigint; s: bigint } => {
  if (der[0] !== 0x30) throw new Error("KMS returned malformed DER");
  const sequence = readDerLength(der, 1);
  if (sequence.next + sequence.length !== der.length) {
    throw new Error("KMS returned malformed DER");
  }
  const r = readDerInteger(der, sequence.next);
  const s = readDerInteger(der, r.next);
  if (
    s.next !== der.length ||
    r.value === 0n ||
    s.value === 0n ||
    r.value >= CURVE_ORDER ||
    s.value >= CURVE_ORDER
  ) {
    throw new Error("KMS returned malformed DER");
  }
  return {
    r: r.value,
    s: s.value > HALF_CURVE_ORDER ? CURVE_ORDER - s.value : s.value,
  };
};

const recoverKmsSignature = (
  digest: string,
  der: Uint8Array,
  expectedAddress: string,
): string => {
  const { r, s } = decodeKmsSignature(der);
  for (const yParity of [0, 1] as const) {
    const signature = Signature.from({
      r: toBeHex(r, 32),
      s: toBeHex(s, 32),
      yParity,
    });
    if (
      safeChecksum(recoverAddress(digest, signature)) ===
      safeChecksum(expectedAddress)
    ) {
      return signature.serialized;
    }
  }
  throw new Error("KMS returned a signature from an unexpected key");
};

const signDigest = async (
  config: AwsKmsConfig,
  digest: string,
): Promise<string> => {
  const response = await getClient(config).send(
    new SignCommand({
      KeyId: config.keyId,
      Message: getBytes(digest),
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    }),
  );
  if (!response.Signature) throw new Error("AWS KMS returned no signature");
  return recoverKmsSignature(digest, response.Signature, config.address);
};

export const validateAwsKmsAddress = async (
  config: AwsKmsConfig,
): Promise<void> => {
  const response = await getClient(config).send(
    new GetPublicKeyCommand({ KeyId: config.keyId }),
  );
  if (!response.PublicKey) throw new Error("AWS KMS returned no public key");
  const jwk = createPublicKey({
    key: Buffer.from(response.PublicKey),
    format: "der",
    type: "spki",
  }).export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("AWS KMS returned an invalid EC public key");
  const decode = (value: string) => Buffer.from(value, "base64url");
  const publicKey = Buffer.concat([
    Buffer.from([4]),
    decode(jwk.x),
    decode(jwk.y),
  ]);
  if (
    safeChecksum(computeAddress(hexlify(publicKey))) !==
    safeChecksum(config.address)
  ) {
    throw new Error("AWS KMS public key does not match configured address");
  }
};

export class DigestKmsSigner extends AbstractSigner<Provider> {
  constructor(
    private readonly kmsConfig: AwsKmsConfig,
    provider: Provider,
  ) {
    super(provider);
  }

  getAddress(): Promise<string> {
    return Promise.resolve(safeChecksum(this.kmsConfig.address));
  }

  connect(provider: null | Provider): DigestKmsSigner {
    if (!provider) throw new Error("KMS signer requires a provider");
    return new DigestKmsSigner(this.kmsConfig, provider);
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const transaction = Transaction.from(tx as any);
    transaction.signature = await signDigest(
      this.kmsConfig,
      transaction.unsignedHash,
    );
    return transaction.serialized;
  }

  signMessage(message: string | Uint8Array): Promise<string> {
    return signDigest(this.kmsConfig, hashMessage(message));
  }

  signTypedData(
    domain: Record<string, any>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, any>,
  ): Promise<string> {
    return signDigest(
      this.kmsConfig,
      TypedDataEncoder.hash(domain, types, value),
    );
  }
}

export class KmsEip1193Provider {
  private readonly rpc: JsonRpcProvider;
  private readonly signer: DigestKmsSigner;

  constructor(
    rpcUrl: string,
    private readonly kmsConfig: AwsKmsConfig,
  ) {
    this.rpc = new JsonRpcProvider(rpcUrl);
    this.signer = new DigestKmsSigner(kmsConfig, this.rpc);
  }

  async request({
    method,
    params = [],
  }: {
    method: string;
    params?: object | readonly unknown[];
  }): Promise<any> {
    const values = Array.isArray(params) ? [...params] : params ? [params] : [];
    if (method === "eth_accounts" || method === "eth_requestAccounts") {
      return [safeChecksum(this.kmsConfig.address)];
    }
    if (method === "eth_sign") {
      const digest = values.find(
        (value) =>
          typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value),
      );
      if (!digest) throw new Error("eth_sign digest is missing");
      return signDigest(this.kmsConfig, digest);
    }
    if (method === "personal_sign") {
      const message = values.find(
        (value) =>
          typeof value === "string" &&
          value.toLowerCase() !== this.kmsConfig.address.toLowerCase(),
      );
      if (!message) throw new Error("personal_sign message is missing");
      return signDigest(this.kmsConfig, hashMessage(getBytes(message)));
    }
    if (method === "eth_signTypedData_v4") {
      const typedDataValue = values.find(
        (value) =>
          typeof value === "string" && value.trim().startsWith("{"),
      );
      if (!typedDataValue) throw new Error("Typed data is missing");
      const typedData = JSON.parse(typedDataValue);
      const types = { ...typedData.types };
      delete types.EIP712Domain;
      return signDigest(
        this.kmsConfig,
        TypedDataEncoder.hash(typedData.domain, types, typedData.message),
      );
    }
    if (method === "eth_sendTransaction") {
      const response = await this.signer.sendTransaction(values[0] as any);
      return response.hash;
    }
    if (method === "eth_signTransaction") {
      return this.signer.signTransaction(
        await this.signer.populateTransaction(values[0] as any),
      );
    }
    return this.rpc.send(method, values);
  }
}
