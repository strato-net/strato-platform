const { readFileSync } = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");
const { vaultGetAddress, signTransaction, submitSignedTransaction } = require("./send-tx");

const DEFAULT_NETWORK_RPC = process.env.NETWORK_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const CONTRACT_FILE = path.join(__dirname, "TestMintableERC20.sol");

function getArgValue(args, flag, fallback) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : fallback;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function compileContract() {
  const source = readFileSync(CONTRACT_FILE, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      "TestMintableERC20.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors) {
    const fatalErrors = output.errors.filter((err) => err.severity === "error");
    if (fatalErrors.length) {
      throw new Error(fatalErrors.map((err) => err.formattedMessage).join("\n"));
    }
  }

  const contract = output.contracts["TestMintableERC20.sol"].TestMintableERC20;
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const submit = hasFlag(args, "--submit");
  const name = getArgValue(args, "--name", "Test USDST");
  const symbol = getArgValue(args, "--symbol", "tUSDST");
  const decimals = Number(getArgValue(args, "--decimals", "18"));
  const ownerArg = getArgValue(args, "--owner");

  console.log("Deploy Test Mintable ERC20");
  console.log("==========================");
  console.log(`rpc=${DEFAULT_NETWORK_RPC}`);
  console.log(`submit=${submit}`);
  console.log(`name=${name}`);
  console.log(`symbol=${symbol}`);
  console.log(`decimals=${decimals}`);

  const { address: vaultAddress } = await vaultGetAddress();
  const owner = ownerArg ? ethers.getAddress(ownerArg) : vaultAddress;
  console.log(`vaultAddress=${vaultAddress}`);
  console.log(`owner=${owner}`);

  const { abi, bytecode } = compileContract();
  const provider = new ethers.JsonRpcProvider(DEFAULT_NETWORK_RPC);
  const factory = new ethers.Interface(abi);
  const deployData = ethers.concat([
    bytecode,
    factory.encodeDeploy([name, symbol, decimals, owner]),
  ]);

  const gasEstimate = await provider.estimateGas({
    from: vaultAddress,
    data: deployData,
  });
  const gasLimit = (gasEstimate * 12n) / 10n;

  const signedTx = await signTransaction(provider, vaultAddress, {
    to: null,
    data: deployData,
    value: 0n,
    gasLimit,
  });

  console.log(`deployTxHash=${signedTx.hash}`);
  if (!submit) {
    console.log("Dry-run complete. Re-run with --submit to broadcast.");
    return;
  }

  const { response, receipt } = await submitSignedTransaction(provider, signedTx);
  const contractAddress = ethers.getCreateAddress({
    from: vaultAddress,
    nonce: response.nonce,
  });

  console.log(`submittedTxHash=${response.hash}`);
  console.log(`block=${receipt.blockNumber}`);
  console.log(`contractAddress=${contractAddress}`);
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
