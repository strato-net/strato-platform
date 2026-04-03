const { ethers } = require("ethers");

const SPOKE_POOL_ABI = [
  "function getRelayerRefund(address l2TokenAddress, address refundAddress) view returns (uint256)",
  "event RelayedRootBundle(uint32 indexed rootBundleId, bytes32 indexed relayerRefundRoot, bytes32 indexed slowRelayRoot)",
  "event ExecutedRelayerRefundRoot(uint256 amountToReturn,uint256 chainId,uint256[] refundAmounts,uint32 indexed rootBundleId,uint32 leafId,bytes32 indexed l2TokenAddress,address[] refundAddresses,bool deferredRefunds,address caller)",
  "event ClaimedRelayerRefund(bytes32 indexed l2TokenAddress, bytes32 indexed refundAddress, uint256 amount, address indexed caller)",
];

const DEFAULT_ORIGIN_RPC = process.env.ORIGIN_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_ORIGIN_SPOKE_POOL = process.env.ORIGIN_SPOKE_POOL || "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662";

function getArgValue(args, flag, fallback) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  const tokenArg = getArgValue(args, "--token", process.env.TOKEN_ADDRESS);
  const relayerArg = getArgValue(args, "--relayer", process.env.RELAYER_ADDRESS);
  if (!tokenArg || !relayerArg) {
    throw new Error(
      "Usage: node check-relayer-refund.js --token 0x... --relayer 0x... [--rpc https://...] [--spoke-pool 0x...] [--lookback-blocks 50000]"
    );
  }
  const rpc = getArgValue(args, "--rpc", DEFAULT_ORIGIN_RPC);
  const spokePool = ethers.getAddress(getArgValue(args, "--spoke-pool", DEFAULT_ORIGIN_SPOKE_POOL));
  const token = ethers.getAddress(tokenArg);
  const relayer = ethers.getAddress(relayerArg);
  const lookback = Number(getArgValue(args, "--lookback-blocks", "50000"));

  const provider = new ethers.JsonRpcProvider(rpc);
  const contract = new ethers.Contract(spokePool, SPOKE_POOL_ABI, provider);
  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - lookback);

  const [refund, relayedRoots, executedRefundEvents, claimedRefundEvents] = await Promise.all([
    contract.getRelayerRefund(token, relayer),
    contract.queryFilter(contract.filters.RelayedRootBundle(), fromBlock, currentBlock),
    contract.queryFilter(contract.filters.ExecutedRelayerRefundRoot(), fromBlock, currentBlock),
    contract.queryFilter(contract.filters.ClaimedRelayerRefund(), fromBlock, currentBlock),
  ]);

  const executedRefunds = executedRefundEvents.filter(
    (evt) => ethers.getAddress(ethers.dataSlice(evt.args.l2TokenAddress, 12)) === token
  );
  const claimedRefunds = claimedRefundEvents.filter(
    (evt) =>
      ethers.getAddress(ethers.dataSlice(evt.args.l2TokenAddress, 12)) === token &&
      ethers.getAddress(evt.args.caller) === relayer
  );

  console.log("Relayer Refund Check");
  console.log("====================");
  console.log(`rpc=${rpc}`);
  console.log(`spokePool=${spokePool}`);
  console.log(`token=${token}`);
  console.log(`relayer=${relayer}`);
  console.log(`currentBlock=${currentBlock}`);
  console.log(`fromBlock=${fromBlock}`);
  console.log(`claimableRefund=${refund.toString()}`);
  console.log(`relayedRootBundlesSeen=${relayedRoots.length}`);
  console.log(`executedRefundLeavesForToken=${executedRefunds.length}`);
  console.log(`claimedRefundEventsForRelayer=${claimedRefunds.length}`);

  if (executedRefunds.length > 0) {
    const latest = executedRefunds[executedRefunds.length - 1];
    console.log(`latestExecutedRefundTx=${latest.transactionHash}`);
    console.log(`latestExecutedRefundBlock=${latest.blockNumber}`);
  }

  if (claimedRefunds.length > 0) {
    const latest = claimedRefunds[claimedRefunds.length - 1];
    console.log(`latestClaimedRefundTx=${latest.transactionHash}`);
    console.log(`latestClaimedRefundBlock=${latest.blockNumber}`);
  }
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
