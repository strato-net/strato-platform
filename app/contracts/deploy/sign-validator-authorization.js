// Produce a validator key's consent to an operator, for ValidatorRegistry.register and
// ValidatorRegistry.setOperator: a secp256k1 signature over
//
//   keccak256(abi.encodePacked("STRATO validator operator authorization",
//                              registry, validator, operator, authorizationNonce[validator]))
//
// with no message prefix. A validator's key is its node's vault key, so run this where the
// node's vault is reachable, with the vault URL from the node's ethconf.yaml
// (urlConfig.vaultUrl) and a token the vault accepts for the node's identity:
//
//   VAULT_URL=<vault url> VAULT_TOKEN=<token> \
//     node sign-validator-authorization.js --validator <address> --operator <address>
//
// For a key held outside a vault (dev networks) pass --private-key <hex> instead.
//
//   --registry <address>  ValidatorRegistry proxy (default: helium's)
//   --nonce <n>           authorizationNonce to sign for (default: read from NODE_URL storage)
//   --digest <0x...>      sign this digest as given, e.g. copied from the staking page
//
// The signature is printed only after it recovers to the validator address.
require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');
const config = require('./config');

const DOMAIN = 'STRATO validator operator authorization';
const HELIUM_REGISTRY = 'bfbb75bb6bd0bafa2f5c5b735fe518ade76808dd';

function parseArgs() {
  const a = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < a.length; i++) {
    const m = /^--(.+)$/.exec(a[i]);
    if (!m) throw new Error(`unexpected argument: ${a[i]}`);
    o[m[1]] = a[++i];
  }
  return o;
}

function address(label, value) {
  const hex = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new Error(`--${label}: not an address: ${value}`);
  return `0x${hex}`;
}

const word = (hex) => `0x${String(hex).replace(/^0x/, '').padStart(64, '0')}`;

async function registryNonce(registry, validator) {
  if (!config.nodes[0].url) throw new Error('NODE_URL is not set; pass --nonce or --digest');
  const { data } = await axios.get(`${config.nodes[0].url}/strato-api/eth/v1.2/storage`, {
    params: { address: registry.slice(2) }, timeout: 60000,
  });
  const row = data.find(r => r.key === `authorizationNonce[${validator.slice(2)}]`);
  return row ? BigInt(row.value) : 0n;
}

async function signWithVault(digest) {
  const base = String(process.env.VAULT_URL).replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${process.env.VAULT_TOKEN}` };
  const { data: key } = await axios.get(`${base}/strato/v2.3/key`, { headers, timeout: 30000 });
  const { data: sig } = await axios.post(`${base}/strato/v2.3/signature`,
    { msgHash: digest.slice(2) }, { headers, timeout: 30000 });
  // The vault reports v as a 0/1 recovery id.
  const v = Number(sig.v) < 27 ? Number(sig.v) + 27 : Number(sig.v);
  return { keyAddress: address('vault key', key.address), signature: ethers.Signature.from({ r: word(sig.r), s: word(sig.s), v }) };
}

function signWithPrivateKey(digest, privateKey) {
  const signingKey = new ethers.SigningKey(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  return { keyAddress: ethers.computeAddress(signingKey.publicKey).toLowerCase(), signature: signingKey.sign(digest) };
}

(async () => {
  const args = parseArgs();
  const validator = address('validator', args.validator);

  let digest = args.digest;
  if (digest) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) throw new Error(`--digest: not 32 bytes of hex: ${digest}`);
  } else {
    const operator = address('operator', args.operator);
    const registry = address('registry', args.registry || HELIUM_REGISTRY);
    const nonce = args.nonce !== undefined ? BigInt(args.nonce) : await registryNonce(registry, validator);
    digest = ethers.solidityPackedKeccak256(
      ['string', 'address', 'address', 'address', 'uint256'],
      [DOMAIN, registry, validator, operator, nonce]);
    console.error(`registry ${registry}\nvalidator ${validator}\noperator ${operator}\nnonce ${nonce}`);
  }
  console.error(`digest ${digest}`);

  let signed;
  if (args['private-key']) signed = signWithPrivateKey(digest, args['private-key']);
  else if (process.env.VAULT_URL && process.env.VAULT_TOKEN) signed = await signWithVault(digest);
  else throw new Error('set VAULT_URL and VAULT_TOKEN, or pass --private-key');

  if (signed.keyAddress !== validator) {
    throw new Error(`the signing key is ${signed.keyAddress}, not the validator ${validator}`);
  }
  const recovered = ethers.recoverAddress(digest, signed.signature).toLowerCase();
  if (recovered !== validator) {
    throw new Error(`signature recovers to ${recovered}, not the validator ${validator}`);
  }

  // r || s || v, the form the staking page and backend accept.
  console.log(signed.signature.serialized);
})().catch(e => { console.error('FAILED:', e.message.slice(0, 300)); process.exit(1); });
