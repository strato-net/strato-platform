import * as fs from "fs";
import * as path from "path";
import { BuiltTx, GasConfig } from "../types";

export function buildContractDeployBatch(
  contractSource: string,
  contractName: string,
  args: Record<string, any>,
  batchSize: number,
  gas: GasConfig,
): BuiltTx {
  const src = fs.readFileSync(path.resolve(contractSource), "utf8");

  const txs = Array.from({ length: batchSize }, () => ({
    type: "CONTRACT" as const,
    payload: {
      contract: contractName,
      src,
      args,
    },
  }));

  return {
    txs,
    txParams: {
      gasLimit: gas.limit,
      gasPrice: gas.price,
    },
  };
}

export function buildFunctionCallBatch(
  contractName: string,
  contractAddress: string,
  method: string,
  args: Record<string, any>,
  batchSize: number,
  gas: GasConfig,
): BuiltTx {
  const txs = Array.from({ length: batchSize }, () => ({
    type: "FUNCTION" as const,
    payload: {
      contractName,
      contractAddress,
      method,
      args,
    },
  }));

  return {
    txs,
    txParams: {
      gasLimit: gas.limit,
      gasPrice: gas.price,
    },
  };
}

export function buildTransferBatch(
  toAddress: string,
  value: string,
  batchSize: number,
  gas: GasConfig,
): BuiltTx {
  const txs = Array.from({ length: batchSize }, () => ({
    type: "TRANSFER" as const,
    payload: {
      contractName: "",
      contractAddress: toAddress,
      args: { value },
    },
  }));

  return {
    txs,
    txParams: {
      gasLimit: gas.limit,
      gasPrice: gas.price,
    },
  };
}
