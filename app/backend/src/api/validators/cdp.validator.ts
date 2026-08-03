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

export function validateOpenJuniorNoteArgs(args: any) {
  const schema = Joi.object({
    asset: validateAddressField("asset"),
    amountUSDST: numericStringField("amountUSDST"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Open Junior Note Argument Validation Error: " + error.message);
  }
}

export function validateTopUpJuniorNoteArgs(args: any) {
  const schema = Joi.object({
    amountUSDST: numericStringField("amountUSDST"),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Top Up Junior Note Argument Validation Error: " + error.message);
  }
}

// Admin Validators
export function validateSetCollateralConfigArgs(args: any) {
  const WAD = BigInt(10) ** BigInt(18);
  const RAY = BigInt(10) ** BigInt(27);
  
  const schema = Joi.object({
    asset: validateAddressField("asset"),
    liquidationRatio: Joi.string().custom((value, helpers) => {
      if (BigInt(value) < WAD) {
        return helpers.error('custom.liquidationRatio');
      }
      return value;
    }).messages({
      'custom.liquidationRatio': 'Liquidation ratio must be >= 1e18 (WAD format)'
    }),
    minCR: Joi.string().custom((value, helpers) => {
      if (BigInt(value) < WAD) {
        return helpers.error('custom.minCR');
      }
      return value;
    }).messages({
      'custom.minCR': 'Min collateral ratio must be >= 1e18 (WAD format)'
    }).required(),
    liquidationPenaltyBps: Joi.number().integer().min(500).max(3000).required(),
    closeFactorBps: Joi.number().integer().min(5000).max(10000).required(),
    stabilityFeeRate: Joi.string().custom((value, helpers) => {
      if (BigInt(value) < RAY) {
        return helpers.error('custom.stabilityFeeRate');
      }
      return value;
    }).messages({
      'custom.stabilityFeeRate': 'Stability fee rate must be >= 1e27 (RAY format)'
    }),
    debtFloor: Joi.string().custom((value, helpers) => {
      if (BigInt(value) < 0) {
        return helpers.error('custom.debtFloor');
      }
      return value;
    }).messages({
      'custom.debtFloor': 'Debt floor must be >= 0'
    }),
    debtCeiling: Joi.string().custom((value, helpers) => {
      if (BigInt(value) < 0) {
        return helpers.error('custom.debtCeiling');
      }
      return value;
    }).messages({
      'custom.debtCeiling': 'Debt ceiling must be >= 0'
    }),
    unitScale: Joi.string().custom((value, helpers) => {
      if (BigInt(value) <= 0) {
        return helpers.error('custom.unitScale');
      }
      return value;
    }).messages({
      'custom.unitScale': 'Unit scale must be > 0'
    }),
    isPaused: Joi.boolean().required()
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("CDP Set Collateral Config Argument Validation Error: " + error.message);
  }
} 