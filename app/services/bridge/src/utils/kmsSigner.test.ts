import assert from "node:assert/strict";
import test from "node:test";
import { createPublicKey } from "node:crypto";
import { GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { JsonRpcProvider, Wallet, getBytes, hashMessage } from "ethers";
import {
  DigestKmsSigner,
  KmsEip1193Provider,
  validateAwsKmsAddress,
} from "./kmsSigner";

const derSignature = (r: string, s: string): Uint8Array => {
  const integer = (value: string) => {
    let bytes = Buffer.from(value.replace(/^0x/, ""), "hex");
    while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
    if ((bytes[0] & 0x80) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes]);
    return Buffer.concat([Buffer.from([2, bytes.length]), bytes]);
  };
  const values = Buffer.concat([integer(r), integer(s)]);
  return Buffer.concat([Buffer.from([0x30, values.length]), values]);
};

const publicKeyDer = (wallet: { signingKey: { publicKey: string } }): Buffer => {
  const publicKey = Buffer.from(getBytes(wallet.signingKey.publicKey));
  return createPublicKey({
    key: {
      kty: "EC",
      crv: "secp256k1",
      x: publicKey.subarray(1, 33).toString("base64url"),
      y: publicKey.subarray(33).toString("base64url"),
    },
    format: "jwk",
  })
    .export({ format: "der", type: "spki" }) as Buffer;
};

test("signs directly through AWS KMS workload identity", async () => {
  const wallet = Wallet.createRandom();
  const digest = hashMessage("safe proposal");
  const requested: any[] = [];
  const client = {
    send: async (command: SignCommand | GetPublicKeyCommand) => {
      requested.push(command);
      if (command instanceof GetPublicKeyCommand) {
        return { PublicKey: publicKeyDer(wallet) };
      }
      const signature = wallet.signingKey.sign(digest);
      return { Signature: derSignature(signature.r, signature.s) };
    },
  };
  const config = {
    address: wallet.address,
    keyId: "alias/eab-safe-proposer",
    region: "us-east-1",
    client,
  };
  const signer = new DigestKmsSigner(
    config,
    new JsonRpcProvider(),
  );

  assert.equal(await signer.signMessage("safe proposal"), wallet.signingKey.sign(digest).serialized);
  assert.ok(requested[0] instanceof SignCommand);
  assert.equal(requested[0].input.KeyId, config.keyId);
  assert.equal(requested[0].input.MessageType, "DIGEST");
  await validateAwsKmsAddress(config);
  assert.ok(requested[1] instanceof GetPublicKeyCommand);

  const provider = new KmsEip1193Provider("http://localhost:8545", config);
  assert.equal(
    await provider.request({
      method: "eth_sign",
      params: [wallet.address, digest],
    }),
    wallet.signingKey.sign(digest).serialized,
  );
});

test("rejects a signature from an unexpected KMS key", async () => {
  const wallet = Wallet.createRandom();
  const otherWallet = Wallet.createRandom();
  const digest = hashMessage("safe proposal");
  const signer = new DigestKmsSigner(
    {
      address: wallet.address,
      keyId: "alias/wrong",
      region: "us-east-1",
      client: {
        send: async () => {
          const signature = otherWallet.signingKey.sign(digest);
          return { Signature: derSignature(signature.r, signature.s) };
        },
      },
    },
    new JsonRpcProvider(),
  );
  await assert.rejects(() => signer.signMessage("safe proposal"), /unexpected key/);
});
