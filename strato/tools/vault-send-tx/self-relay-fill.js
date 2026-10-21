const { ethers } = require("ethers");
const { vaultGetAddress, signTransaction, submitSignedTransaction } = require("./send-tx");

const ERC20_ABI = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
];

const SPOKE_POOL_ABI = [
  "function depositV3Now(address depositor,address recipient,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address exclusiveRelayer,uint32 fillDeadlineOffset,uint32 exclusivityDeadline,bytes message) payable",
  "function fillV3Relay((address depositor,address recipient,address exclusiveRelayer,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 originChainId,uint32 depositId,uint32 fillDeadline,uint32 exclusivityDeadline,bytes message) relayData,uint256 repaymentChainId)",
  "event FundsDeposited(bytes32 inputToken,bytes32 outputToken,uint256 inputAmount,uint256 outputAmount,uint256 indexed destinationChainId,uint256 indexed depositId,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes32 indexed depositor,bytes32 recipient,bytes32 exclusiveRelayer,bytes message)",
];

const DEFAULT_ORIGIN_RPC = process.env.ORIGIN_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_DESTINATION_RPC = process.env.DESTINATION_RPC || "https://sepolia.base.org";
const DEFAULT_ORIGIN_SPOKE_POOL = process.env.ORIGIN_SPOKE_POOL || "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662";
const DEFAULT_DESTINATION_SPOKE_POOL =
  process.env.DESTINATION_SPOKE_POOL || "0x82B564983aE7274c86695917BBf8C99ECb6F0F8F";
const DEFAULT_ORIGIN_CHAIN_ID = Number(process.env.ORIGIN_CHAIN_ID || "11155111");
const DEFAULT_DESTINATION_CHAIN_ID = Number(process.env.DESTINATION_CHAIN_ID || "84532");

function getArgValue(args, flag, fallback) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : fallback;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

async function sendTx({ provider, fromAddress, txRequest, label, submit }) {
  const gasEstimate = await provider.estimateGas({
    from: fromAddress,
    to: txRequest.to,
    data: txRequest.data,
    value: BigInt(txRequest.value || "0"),
  });
  const gasLimit = (gasEstimate * 12n) / 10n;
  const signedTx = await signTransaction(provider, fromAddress, { ...txRequest, gasLimit });
  console.log(`\n=== ${label} ===`);
  console.log(`hash=${signedTx.hash}`);
  if (!submit) return { hash: signedTx.hash, receipt: null };
  const { response, receipt } = await submitSignedTransaction(provider, signedTx);
  console.log(`submitted=${response.hash} block=${receipt.blockNumber} status=${receipt.status}`);
  return { hash: response.hash, receipt };
}

async function ensureAllowance({ provider, tokenAddress, owner, spender, amount, submit, label }) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const allowance = await token.allowance(owner, spender);
  console.log(`${label}Allowance=${allowance.toString()}`);
  if (allowance >= amount) return;

  const iface = new ethers.Interface(ERC20_ABI);
  const data = iface.encodeFunctionData("approve", [spender, ethers.MaxUint256]);
  await sendTx({
    provider,
    fromAddress: owner,
    txRequest: { to: tokenAddress, data, value: 0n },
    label: `${label}-approve`,
    submit,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const submit = hasFlag(args, "--submit");
  const inputTokenArg = getArgValue(args, "--input-token", process.env.INPUT_TOKEN);
  const outputTokenArg = getArgValue(args, "--output-token", process.env.OUTPUT_TOKEN);
  if (!inputTokenArg || !outputTokenArg) {
    throw new Error(
      "Usage: node self-relay-fill.js --input-token 0x... --output-token 0x... [--recipient 0x...] [--amount 1] [--decimals 18] [--submit]"
    );
  }

  const amount = ethers.parseUnits(getArgValue(args, "--amount", "1"), Number(getArgValue(args, "--decimals", "18")));
  const fillDeadlineOffset = Number(getArgValue(args, "--fill-deadline-offset", "3600"));

  const { address: relayer } = await vaultGetAddress();
  const recipient = ethers.getAddress(getArgValue(args, "--recipient", relayer));
  const inputToken = ethers.getAddress(inputTokenArg);
  const outputToken = ethers.getAddress(outputTokenArg);
  const originProvider = new ethers.JsonRpcProvider(DEFAULT_ORIGIN_RPC);
  const destinationProvider = new ethers.JsonRpcProvider(DEFAULT_DESTINATION_RPC);
  const spokePoolIface = new ethers.Interface(SPOKE_POOL_ABI);

  console.log("Self Relay Custom Fill");
  console.log("======================");
  console.log(`submit=${submit}`);
  console.log(`relayer=${relayer}`);
  console.log(`recipient=${recipient}`);
  console.log(`inputToken=${inputToken}`);
  console.log(`outputToken=${outputToken}`);
  console.log(`amount=${amount.toString()}`);

  await ensureAllowance({
    provider: originProvider,
    tokenAddress: inputToken,
    owner: relayer,
    spender: DEFAULT_ORIGIN_SPOKE_POOL,
    amount,
    submit,
    label: "origin",
  });

  await ensureAllowance({
    provider: destinationProvider,
    tokenAddress: outputToken,
    owner: relayer,
    spender: DEFAULT_DESTINATION_SPOKE_POOL,
    amount,
    submit,
    label: "destination",
  });

  const depositData = spokePoolIface.encodeFunctionData("depositV3Now", [
    relayer,
    recipient,
    inputToken,
    outputToken,
    amount,
    amount,
    DEFAULT_DESTINATION_CHAIN_ID,
    ethers.ZeroAddress,
    fillDeadlineOffset,
    0,
    "0x",
  ]);

  const depositResult = await sendTx({
    provider: originProvider,
    fromAddress: relayer,
    txRequest: { to: DEFAULT_ORIGIN_SPOKE_POOL, data: depositData, value: 0n },
    label: "depositV3Now",
    submit,
  });

  if (!submit) return;

  const receipt = await originProvider.getTransactionReceipt(depositResult.hash);
  const depositLog = receipt.logs
    .map((log) => {
      try {
        return spokePoolIface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log) => log && log.name === "FundsDeposited");

  if (!depositLog) throw new Error("FundsDeposited event not found");

  const relayData = {
    depositor: relayer,
    recipient,
    exclusiveRelayer: ethers.ZeroAddress,
    inputToken,
    outputToken,
    inputAmount: depositLog.args.inputAmount,
    outputAmount: depositLog.args.outputAmount,
    originChainId: DEFAULT_ORIGIN_CHAIN_ID,
    depositId: Number(depositLog.args.depositId),
    fillDeadline: depositLog.args.fillDeadline,
    exclusivityDeadline: depositLog.args.exclusivityDeadline,
    message: "0x",
  };

  console.log(`depositId=${relayData.depositId}`);
  console.log(`fillDeadline=${relayData.fillDeadline}`);
  console.log(`exclusivityDeadline=${relayData.exclusivityDeadline}`);

  const fillData = spokePoolIface.encodeFunctionData("fillV3Relay", [relayData, DEFAULT_ORIGIN_CHAIN_ID]);
  await sendTx({
    provider: destinationProvider,
    fromAddress: relayer,
    txRequest: { to: DEFAULT_DESTINATION_SPOKE_POOL, data: fillData, value: 0n },
    label: "fillV3Relay",
    submit,
  });
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
