import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

// Validator functions with inline schemas
export function validateDepositLiquidityArgs(args: any) {
  const schema = Joi.object({
    amount: numericStringField("amount"),
    stakeMToken: Joi.boolean().required(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Deposit Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateWithdrawLiquidityArgs(args: any) {
  const schema = Joi.object({
    amount: numericStringField("amount"),
    includeStakedMToken: Joi.boolean().required(),
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

// NEW: dedicated validator for withdraw-collateral-max (asset only)
export function validateWithdrawCollateralMaxArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Withdraw Collateral Max Argument Validation Error: " + error.message);
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
    perSecondFactorRAY: Joi.string().pattern(/^\d+$/).custom((value, helpers) => {
      try {
        const rayValue = BigInt(value);
        const minRAY = BigInt('1000000000000000000000000000'); // 1e27
        if (rayValue < minRAY) {
          return helpers.error('any.invalid');
        }
        return value;
      } catch (error) {
        return helpers.error('any.invalid');
      }
    }).required().messages({
      'any.invalid': 'perSecondFactorRAY must be >= 1e27 (1 RAY)',
      'string.pattern.base': 'perSecondFactorRAY must be a valid integer string'
    }),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Configure Asset Argument Validation Error: " + error.message);
  }
}

export function validateSweepReservesArgs(args: any) {
  const schema = Joi.object({
    amount: numericStringField("amount"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Sweep Reserves Argument Validation Error: " + error.message);
  }
}

export function validateSetDebtCeilingsArgs(args: any) {
  const schema = Joi.object({
    assetUnits: numericStringField("assetUnits", {allowZero: true}),
    usdValue: numericStringField("usdValue", {allowZero: true}),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Set Debt Ceilings Argument Validation Error: " + error.message);
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
        Joi.string().valid("0"),
        Joi.string().valid("ALL")
      )
      .optional()
      .messages({
        "alternatives.match": "Repay amount must be a non-negative integer string, 'ALL', or number.",
      }),
    minCollateralOut: Joi.string()
      .trim()
      .pattern(/^\d+$/)
      .allow('')
      .optional()
      .messages({
        "string.pattern.base": "minCollateralOut must be a valid numeric string (integer wei format).",
      }),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Liquidation Argument Validation Error: " + error.message);
  }
}
