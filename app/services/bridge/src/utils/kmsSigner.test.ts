import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { JsonRpcProvider, Wallet, hashMessage } from "ethers";
import { DigestKmsSigner, KmsEip1193Provider } from "./kmsSigner";

test("signs through KMS and rejects an unexpected key", async () => {
  const wallet = Wallet.createRandom();
  const otherWallet = Wallet.createRandom();
  const digest = hashMessage("safe proposal");
  const originalPost = axios.post;
  const requested: any[] = [];
  const signer = new DigestKmsSigner(
    {
      address: wallet.address,
      url: "https://kms.example/sign",
      apiToken: "token",
    },
    new JsonRpcProvider(),
  );

  try {
    (axios as any).post = async (
      url: string,
      payload: unknown,
      options: unknown,
    ) => {
      requested.push({ url, payload, options });
      return {
        data: { signature: wallet.signingKey.sign(digest).serialized },
      };
    };
    await signer.signMessage("safe proposal");
    assert.deepEqual(requested[0], {
      url: "https://kms.example/sign",
      payload: { digest },
      options: {
        headers: { Authorization: "Bearer token" },
      },
    });
    const provider = new KmsEip1193Provider("http://localhost:8545", {
      address: wallet.address,
      url: "https://kms.example/sign",
      apiToken: "token",
    });
    assert.equal(
      await provider.request({
        method: "eth_sign",
        params: [wallet.address, digest],
      }),
      wallet.signingKey.sign(digest).serialized,
    );

    (axios as any).post = async () => ({
      data: { signature: otherWallet.signingKey.sign(digest).serialized },
    });
    await assert.rejects(
      () => signer.signMessage("safe proposal"),
      /unexpected key/,
    );
  } finally {
    axios.post = originalPost;
  }
});
