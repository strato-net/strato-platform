// Generates the synthetic receipt + signed ClaimAssignment for the
// EthBridgeIn assignment-redirect tests. Output is the pieces a
// Solidity test embeds inline.
const { ethers } = require('ethers');
const { keccak256, getBytes, hexlify, AbiCoder } = ethers;

// ─── Test constants ──────────────────────────────────────────────────
const ROUTER             = '0xc0DE000000000000000000000000000000000001';
const ETH_TOKEN          = '0x3333333333333333333333333333333333333333';
const ETH_SENDER         = '0x1111111111111111111111111111111111111111';
const ETH_SENDER_KEY     = '0x1111111111111111111111111111111111111111111111111111111111111111';
const TARGET_STRATO_TOK  = '0x4444444444444444444444444444444444444444';
const AMOUNT             = 1234567890n;
const DEPOSIT_ID         = 99n;

// Derive the recipient address from a hardcoded test private key. We
// sign all assignment messages with this key, so the contract's
// ecrecover(...) returns this address.
const RECIPIENT_KEY      = '0x2222222222222222222222222222222222222222222222222222222222222222';
const recipientWallet    = new ethers.Wallet(RECIPIENT_KEY);
const RECIPIENT_ADDR     = recipientWallet.address;

// A different key for negative-test (wrong signer).
const ATTACKER_KEY       = '0x3333333333333333333333333333333333333333333333333333333333333333';
const attackerWallet     = new ethers.Wallet(ATTACKER_KEY);

console.log('// Recipient (signer):', RECIPIENT_ADDR);
console.log('// Attacker (wrong-signer test):', attackerWallet.address);

// ─── Build the synthetic receipt RLP + MPT trie root ─────────────────
const EVENT_SIG = ethers.id("DepositRouted(address,uint256,address,address,address,uint96)");
const topicAddr = (a) => ethers.zeroPadValue(a.toLowerCase(), 32);

const dataHex = AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'uint96'],
    [AMOUNT, TARGET_STRATO_TOK, DEPOSIT_ID]
);

const log = [
    getBytes(ROUTER),
    [
        getBytes(EVENT_SIG),
        getBytes(topicAddr(ETH_TOKEN)),
        getBytes(topicAddr(ETH_SENDER)),
        getBytes(topicAddr(RECIPIENT_ADDR)),  // <-- signer address
    ],
    getBytes(dataHex),
];

const receipt = [
    new Uint8Array([1]),
    new Uint8Array([0x52, 0x08]),   // gasUsed = 21000
    new Uint8Array(256),             // logs_bloom (zeros)
    [log],
];
const receiptRlp = ethers.encodeRlp(receipt);

const hpPath = new Uint8Array([0x20, 0x80]);
const leafNode = ethers.encodeRlp([hpPath, getBytes(receiptRlp)]);
const trieRoot = keccak256(leafNode);

console.log('// Receipt RLP length:', (receiptRlp.length / 2 - 1), 'bytes');
console.log('// Trie root:', trieRoot);

// ─── Build the EIP-712 domain + assignment hashes ────────────────────
// keccak256("EthBridgeIn:v1") — must match the contract constant.
const DOMAIN_SEPARATOR = ethers.id("EthBridgeIn:v1");
console.log('// DOMAIN_SEPARATOR:', DOMAIN_SEPARATOR);

const ASSIGNMENT_TYPEHASH = ethers.id("ClaimAssignment(bytes32 depositKey,address newRecipient,uint256 deadline)");
console.log('// ASSIGNMENT_TYPEHASH:', ASSIGNMENT_TYPEHASH);

// Compute the depositKey for our (srcChainId, blockNumber, txIndex, logIndex).
// Mirrors the contract: keccak256(abi.encode(srcChainId, blockNumber, txIndex, logIndex)).
const SRC_CHAIN_ID = 11155111;
const BLOCK_NUM = 1234;
const TX_IDX = 0;
const LOG_IDX = 0;
const depositKey = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256', 'uint256', 'uint256'],
    [SRC_CHAIN_ID, BLOCK_NUM, TX_IDX, LOG_IDX]
));
console.log('// depositKey:', depositKey);

// Build a structHash for a real assignment: redirect to NEW_RECIPIENT,
// deadline far in the future.
const NEW_RECIPIENT = '0x9999999999999999999999999999999999999999';
const VALID_DEADLINE = 9999999999n;  // year ~2286

function buildDigest(depositKey, newRecipient, deadline) {
    const structHash = keccak256(
        AbiCoder.defaultAbiCoder().encode(
            ['bytes32', 'bytes32', 'address', 'uint256'],
            [ASSIGNMENT_TYPEHASH, depositKey, newRecipient, deadline]
        )
    );
    const digest = keccak256(ethers.concat(['0x1901', DOMAIN_SEPARATOR, structHash]));
    return { structHash, digest };
}

function signDigest(wallet, digest) {
    // Sign the raw digest (no extra hashing). ethers' wallet.signingKey
    // exposes the raw ECDSA primitive.
    const sigObj = wallet.signingKey.sign(digest);
    return { v: sigObj.v, r: sigObj.r, s: sigObj.s };
}

// Valid assignment from RECIPIENT
{
    const { digest } = buildDigest(depositKey, NEW_RECIPIENT, VALID_DEADLINE);
    const { v, r, s } = signDigest(recipientWallet, digest);
    console.log('// === valid assignment from recipient ===');
    console.log('//   newRecipient:', NEW_RECIPIENT);
    console.log('//   deadline:    ', VALID_DEADLINE.toString());
    console.log('//   v, r, s:');
    console.log('  v =', v, ',  r =', r, ',  s =', s);
}

// Wrong-signer assignment (signed by attacker)
{
    const { digest } = buildDigest(depositKey, NEW_RECIPIENT, VALID_DEADLINE);
    const { v, r, s } = signDigest(attackerWallet, digest);
    console.log('// === assignment signed by attacker (wrong signer) ===');
    console.log('  v =', v, ',  r =', r, ',  s =', s);
}

// Expired assignment (deadline = 0)
{
    const EXPIRED_DEADLINE = 0n;
    const { digest } = buildDigest(depositKey, NEW_RECIPIENT, EXPIRED_DEADLINE);
    const { v, r, s } = signDigest(recipientWallet, digest);
    console.log('// === assignment with expired deadline ===');
    console.log('  v =', v, ',  r =', r, ',  s =', s);
}

// Mismatched-depositKey assignment (signed for a different deposit)
{
    const otherDepositKey = keccak256(AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256', 'uint256', 'uint256'],
        [SRC_CHAIN_ID, 9999, 0, 0]
    ));
    const { digest } = buildDigest(otherDepositKey, NEW_RECIPIENT, VALID_DEADLINE);
    const { v, r, s } = signDigest(recipientWallet, digest);
    console.log('// === assignment for a DIFFERENT depositKey ===');
    console.log('//   otherDepositKey:', otherDepositKey);
    console.log('  v =', v, ',  r =', r, ',  s =', s);
}

console.log('');
console.log('// receipt RLP:');
console.log(receiptRlp);
console.log('// leaf (proof[0]):');
console.log(leafNode);
console.log('// trieRoot:');
console.log(trieRoot);
