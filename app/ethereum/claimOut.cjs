require('dotenv').config();
const { ethers } = require('ethers');
const proof = require(process.env.PROOF);

const LC = '0x73a7d49DbC12cde79c606cabfb79F4abEc8bA05b';
const VAULT = '0x3C78b38255C6a373066cD7148a13E6b1c82d4C71';
const RECIPIENT = '0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce';
const hex = (h) => (h.startsWith('0x') ? h : '0x' + h);

const LC_ABI = [
  'function tip() view returns (uint256)',
  'function submitHeader(bytes headerRLP, bytes[] signatures)',
  'function hasReceiptsRoot(uint256) view returns (bool)',
  'function getReceiptsRoot(uint256) view returns (bytes32)',
];
const VAULT_ABI = [
  'function claimWithdrawal(uint256 blockNumber, uint256 txIndex, uint256 logIndex, bytes[] mptProof, bytes receiptRLP)',
  'function nonceState(bytes32) view returns (uint8)',
];

(async () => {
  const p = new ethers.JsonRpcProvider(process.env.RPC || process.env.SEPOLIA_RPC_URL);
  console.log('chainId:', (await p.getNetwork()).chainId.toString());
  const w = new ethers.Wallet(process.env.PRIVATE_KEY, p);
  console.log('caller:', w.address, ethers.formatEther(await p.getBalance(w.address)), 'ETH');

  const lc = new ethers.Contract(LC, LC_ABI, w);
  const vault = new ethers.Contract(VAULT, VAULT_ABI, w);
  const bn = BigInt(proof.blockNumber);

  console.log('light client tip:', (await lc.tip()).toString(), ' target block:', bn.toString());
  if (!(await lc.hasReceiptsRoot(bn))) {
    console.log('submitting header...');
    const tx = await lc.submitHeader(hex(proof.headerRLP), proof.signatures.map(hex));
    const rc = await tx.wait(1);
    console.log(`  header submitted: ${rc.hash} block ${rc.blockNumber} status ${rc.status}`);
    // These public RPCs are load-balanced and a read immediately after the
    // receipt can still hit a node that hasn't applied the block, which shows
    // up as a bogus "receipts root not stored". Wait for it to be visible.
    for (let i = 0; i < 15 && !(await lc.hasReceiptsRoot(bn)); i++) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!(await lc.hasReceiptsRoot(bn))) throw new Error('receipts root never became visible');
  } else {
    console.log('  receipts root already anchored');
  }
  console.log('receiptsRoot:', await lc.getReceiptsRoot(bn));

  const nonce = ethers.solidityPackedKeccak256(
    ['uint256', 'uint256', 'uint256'],
    [bn, BigInt(proof.txIndex), BigInt(proof.logIndex)]);
  console.log('nonce:', nonce, 'state before:', await vault.nonceState(nonce));

  const before = await p.getBalance(RECIPIENT);
  const vaultBefore = await p.getBalance(VAULT);
  console.log('recipient before:', ethers.formatEther(before), ' vault before:', ethers.formatEther(vaultBefore));

  console.log('claiming...');
  const ctx = await vault.claimWithdrawal(bn, BigInt(proof.txIndex), BigInt(proof.logIndex),
    proof.mptProof.map(hex), hex(proof.receiptRLP), { gasLimit: 800000 });
  const crc = await ctx.wait(1);
  console.log(`  claim: ${crc.hash} block ${crc.blockNumber} status ${crc.status} gas ${crc.gasUsed}`);

  const after = await p.getBalance(RECIPIENT);
  const vaultAfter = await p.getBalance(VAULT);
  console.log('recipient after :', ethers.formatEther(after), ` (+${ethers.formatEther(after - before)})`);
  console.log('vault after     :', ethers.formatEther(vaultAfter), ` (${ethers.formatEther(vaultAfter - vaultBefore)})`);
  console.log('nonce state after:', await vault.nonceState(nonce), '(1 = Claimed)');
})().catch(e => { console.error('FAILED:', e.shortMessage || e.message); process.exit(1); });
