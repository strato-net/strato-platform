import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

// Validator functions
export function validatePoolAddressArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Pool Address Argument Validation Error: " + error.message);
  }
}

export function validateTokenAddressArgs(args: any) {
  const schema = Joi.object({
    tokenAddress: validateAddressField("tokenAddress"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Token Address Argument Validation Error:" + error.message);
  }
}

export function validateTokenPairArgs(args: any) {
  const schema = Joi.object({
    tokenAddress1: validateAddressField("tokenAddress1"),
    tokenAddress2: validateAddressField("tokenAddress2"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Token Pair Argument Validation Error:" + error.message);
  }
}

export function validateCreatePoolsArgs(args: any) {
  const schema = Joi.object({
    tokenA: validateAddressField("tokenA"),
    tokenB: validateAddressField("tokenB"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Create Pool Argument Validation Error: " + error.message);
  }
}

export function validateAddLiquidityArgs(args: any) {
  const schema = Joi.object({
    tokenBAmount: numericStringField("TokenBAmount", { allowZero: true }),
    maxTokenAAmount: numericStringField("MaxTokenAAmount", { allowZero: true }),
  }).custom((value, helpers) => {
    const tokenBZero = value.tokenBAmount === "0" || value.tokenBAmount === 0;
    const tokenAZero = value.maxTokenAAmount === "0" || value.maxTokenAAmount === 0;

    if (tokenBZero && tokenAZero) {
      return helpers.error("object.missing");
    }
    return value;
  }, "At least one amount must be greater than zero");

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Add Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateAddSingleLiquidityArgs(args: any) {
  const schema = Joi.object({
    isAToB: Joi.boolean().required(),
    amountIn: numericStringField("AmountIn"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Add Single Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateRemoveLiquidityArgs(args: any) {
  const schema = Joi.object({
    lpTokenAmount: numericStringField("LpTokenAmount"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Remove Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateSwapArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress"),
    isAToB: Joi.boolean().required(),
    amountIn: numericStringField("AmountIn"),
    minAmountOut: numericStringField("MinAmountOut"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Swap Argument Validation Error: " + error.message);
  }
}

export function validateCalculateSwapArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress"),
    isAToB: Joi.string().valid("true", "false").required(),
    amountIn: numericStringField("AmountIn"),
    reverse: Joi.string().valid("true", "false").optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Calculate Swap Argument Validation Error: " + error.message);
  }
}

export function validateQueryParams(query: any) {
  const schema = Joi.object().pattern(Joi.string(), Joi.string());

  const { error } = schema.validate(query);
  if (error) {
    throw new Error("Query Parameter Validation Error: " + error.message);
  }
}

export function validateSwapHistoryArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Swap History Argument Validation Error: " + error.message);
  }
}

export function validateSetPoolRatesArgs(args: any) {
  const schema = Joi.object({
    poolAddress: Joi.string().required(),
    swapFeeRate: Joi.number().min(0).max(10000).required(), // 0-100% with 2 decimals (10000 = 100%)
    lpSharePercent: Joi.number().min(0).max(10000).required(), // 0-100% with 2 decimals (10000 = 100%)
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Set Pool Rates Argument Validation Error: " + error.message);
  }
}