import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

// CDP Vault Operation Validators
export function validateDepositArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Deposit Argument Validation Error: " + error.message);
  }
}

export function validateWithdrawArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Withdraw Argument Validation Error: " + error.message);
  }
}

export function validateWithdrawMaxArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Withdraw Max Argument Validation Error: " + error.message);
  }
}

export function validateMintArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Mint Argument Validation Error: " + error.message);
  }
}

export function validateMintMaxArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Mint Max Argument Validation Error: " + error.message);
  }
}

export function validateRepayArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Repay Argument Validation Error: " + error.message);
  }
}

export function validateRepayAllArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Repay All Argument Validation Error: " + error.message);
  }
}

export function validateLiquidateArgs(args: any) {
  const schema = Joi.object({
    collateralAsset: validateAddressField("collateralAsset"),
    borrower: validateAddressField("borrower"),
    debtToCover: numericStringField("debtToCover"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Liquidate Argument Validation Error: " + error.message);
  }
} 