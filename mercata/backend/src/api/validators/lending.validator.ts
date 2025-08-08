import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

// Validator functions with inline schemas
export function validateDepositLiquidityArgs(args: any) {
  const schema = Joi.object({
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Deposit Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateWithdrawLiquidityArgs(args: any) {
  const schema = Joi.object({
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Withdraw Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateBorrowArgs(args: any) {
  const schema = Joi.object({
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Borrow Argument Validation Error: " + error.message);
  }
}

export function validateRepayArgs(args: any) {
  const schema = Joi.object({
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Repay Argument Validation Error: " + error.message);
  }
}

export function validateSupplyCollateralArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Supply Collateral Argument Validation Error: " + error.message);
  }
}

export function validateWithdrawCollateralArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
    amount: numericStringField("amount"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Withdraw Collateral Argument Validation Error: " + error.message);
  }
}


export function validateConfigureAssetArgs(args: any) {
  const schema = Joi.object({
    asset: Joi.string().required(),
    ltv: Joi.number().min(100).max(9500).required(),
    liquidationThreshold: Joi.number().min(100).max(9500).required(),
    liquidationBonus: Joi.number().min(10000).max(12500).required(),
    interestRate: Joi.number().min(0).max(10000).required(),
    reserveFactor: Joi.number().min(0).max(5000).required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Configure Asset Argument Validation Error: " + error.message);
  }
}

export function validateLiquidationArgs(args: any) {
  const schema = Joi.object({
    id: Joi.string()
      .required()
      .messages({
        "any.required": "Loan ID is required.",
      }),

    collateralAsset: validateAddressField("collateralAsset"),
    repayAmount: Joi.alternatives()
      .try(
        Joi.string().regex(/^\d+$/),
        Joi.number().min(0),
        Joi.string().valid("0")
      )
      .optional()
      .messages({
        "alternatives.match": "Repay amount must be a non-negative integer string or number.",
      }),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Liquidation Argument Validation Error: " + error.message);
  }
}
