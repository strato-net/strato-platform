import Joi from "@hapi/joi";

// Validator functions with inline schemas
export function validateDepositLiquidityArgs(args: any) {
  const schema = Joi.object({
    amount: Joi.string().pattern(/^\d+$/).required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Deposit Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateWithdrawLiquidityArgs(args: any) {
  const schema = Joi.object({
    amount: Joi.string().pattern(/^\d+$/).required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Withdraw Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateBorrowArgs(args: any) {
  const schema = Joi.object({
    amount: Joi.string().pattern(/^\d+$/).required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Borrow Argument Validation Error: " + error.message);
  }
}

export function validateRepayArgs(args: any) {
  const schema = Joi.object({
    amount: Joi.string().pattern(/^\d+$/).required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Repay Argument Validation Error: " + error.message);
  }
}

export function validateSupplyCollateralArgs(args: any) {
  const schema = Joi.object({
    asset: Joi.string().required(),
    amount: Joi.string().pattern(/^\d+$/).required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Supply Collateral Argument Validation Error: " + error.message);
  }
}

export function validateWithdrawCollateralArgs(args: any) {
  const schema = Joi.object({
    asset: Joi.string().required(),
    amount: Joi.string().pattern(/^\d+$/).required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Withdraw Collateral Argument Validation Error: " + error.message);
  }
}

export function validateSetInterestRateArgs(args: any) {
  const schema = Joi.object({
    asset: Joi.string().required(),
    rate: Joi.number().min(0).max(100).required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Set Interest Rate Argument Validation Error: " + error.message);
  }
}

export function validateSetCollateralRatioArgs(args: any) {
  const schema = Joi.object({
    asset: Joi.string().required(),
    ratio: Joi.number().min(100).max(1000).required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Set Collateral Ratio Argument Validation Error: " + error.message);
  }
}

export function validateSetLiquidationBonusArgs(args: any) {
  const schema = Joi.object({
    asset: Joi.string().required(),
    bonus: Joi.number().min(100).max(200).required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Set Liquidation Bonus Argument Validation Error: " + error.message);
  }
}
