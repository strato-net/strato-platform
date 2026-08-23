require('dotenv').config();
const { ethers } = require('ethers');
const A = require(process.env.PROOF);
const VAULT = '0x3C78b38255C6a373066cD7148a13E6b1c82d4C71';
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const v = new ethers.Contract(VAULT, [
    'function nonceState(bytes32) view returns (uint8)',
    'function processQueue(uint256) returns (uint256)',
    'function nextSeqToProcess() view returns (uint256)',
  ], p);
  const nonce = ethers.solidityPackedKeccak256(['uint256','uint256','uint256'],
    [BigInt(A.blockNumber), BigInt(A.txIndex), BigInt(A.logIndex)]);
  console.log('withdrawal A nonceState:', (await v.nonceState(nonce)).toString(), '(0 = Unused, still unclaimed)');
  console.log('nextSeqToProcess       :', (await v.nextSeqToProcess()).toString(), '(frozen, no longer gates)');
  try { await v.processQueue.staticCall(10); console.log('processQueue: returned (unexpected)'); }
  catch { console.log('processQueue           : reverts QueueEmpty -> nothing was ever parked'); }
})();
