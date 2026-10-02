const { ethers } = require("ethers");
const { vaultGetAddress, signTransaction, submitSignedTransaction } = require("./send-tx");

const DEFAULT_NETWORK_RPC = process.env.NETWORK_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const ERC20_MINT_ABI = ["function mint(address to, uint256 value) returns (bool)"];

function getArgValue(args, flag, fallback) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : fallback;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

async function main() {
  const args = process.argv.slice(2);
  const submit = hasFlag(args, "--submit");
  const token = getArgValue(args, "--token");
  const to = getArgValue(args, "--to");
  const amount = getArgValue(args, "--amount");
  const decimals = Number(getArgValue(args, "--decimals", "18"));

  if (!token || !to || !amount) {
    throw new Error("Usage: node mint-test-token.js --token 0x... --to 0x... --amount 1000 [--decimals 18] [--submit]");
  }

  const tokenAddress = ethers.getAddress(token);
  const recipient = ethers.getAddress(to);
  const mintAmount = ethers.parseUnits(amount, decimals);

  console.log("Mint Test Token");
  console.log("===============");
  console.log(`rpc=${DEFAULT_NETWORK_RPC}`);
  console.log(`submit=${submit}`);
  console.log(`token=${tokenAddress}`);
  console.log(`to=${recipient}`);
  console.log(`amount=${amount}`);
  console.log(`amountBaseUnits=${mintAmount}`);

  const { address: vaultAddress } = await vaultGetAddress();
  console.log(`vaultAddress=${vaultAddress}`);

  const provider = new ethers.JsonRpcProvider(DEFAULT_NETWORK_RPC);
  const iface = new ethers.Interface(ERC20_MINT_ABI);
  const data = iface.encodeFunctionData("mint", [recipient, mintAmount]);
  const gasEstimate = await provider.estimateGas({
    from: vaultAddress,
    to: tokenAddress,
    data,
    value: 0n,
  });
  const gasLimit = (gasEstimate * 12n) / 10n;

  const signedTx = await signTransaction(provider, vaultAddress, {
    to: tokenAddress,
    data,
    value: 0n,
    gasLimit,
  });

  console.log(`mintTxHash=${signedTx.hash}`);
  if (!submit) {
    console.log("Dry-run complete. Re-run with --submit to broadcast.");
    return;
  }

  const { response, receipt } = await submitSignedTransaction(provider, signedTx);
  console.log(`submittedTxHash=${response.hash}`);
  console.log(`block=${receipt.blockNumber}`);
  console.log(`status=${receipt.status}`);
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
