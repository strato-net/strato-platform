import axios from "axios";
import {
  AbstractSigner,
  JsonRpcProvider,
  Provider,
  Signature,
  Transaction,
  TransactionRequest,
  TypedDataEncoder,
  getBytes,
  hashMessage,
  recoverAddress,
} from "ethers";
import { safeChecksum } from "./utils";

export interface DigestKmsConfig {
  address: string;
  url: string;
  apiToken: string;
}

const signDigest = async (
  config: DigestKmsConfig,
  digest: string,
): Promise<string> => {
  const response = await axios.post<{ signature: string }>(
    config.url,
    { digest },
    {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
      },
    },
  );
  const signature = Signature.from(response.data.signature).serialized;
  if (
    safeChecksum(recoverAddress(digest, signature)) !==
    safeChecksum(config.address)
  ) {
    throw new Error("KMS returned a signature from an unexpected key");
  }
  return signature;
};

export class DigestKmsSigner extends AbstractSigner<Provider> {
  constructor(
    private readonly kmsConfig: DigestKmsConfig,
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
    private readonly kmsConfig: DigestKmsConfig,
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
