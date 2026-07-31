import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

// Vault Operation Validators

export function validateDepositArgs(args: any) {
  const schema = Joi.object({
    token: validateAddressField("token"),
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Vault Deposit Argument Validation Error: " + error.message);
  }
}

export function validateWithdrawArgs(args: any) {
  const schema = Joi.object({
    amountUsd: numericStringField("amountUsd"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Vault Withdraw Argument Validation Error: " + error.message);
  }
}

// Admin Validators

export function validateSetMinReserveArgs(args: any) {
  const schema = Joi.object({
    token: validateAddressField("token"),
    minReserve: numericStringField("minReserve", { allowZero: true }),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Vault Set Min Reserve Argument Validation Error: " + error.message);
  }
}

export function validateSetBotExecutorArgs(args: any) {
  const schema = Joi.object({
    executor: validateAddressField("executor"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Vault Set Bot Executor Argument Validation Error: " + error.message);
  }
}

export function validateAssetArgs(args: any) {
  const schema = Joi.object({
    token: validateAddressField("token"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Vault Asset Argument Validation Error: " + error.message);
  }
}
