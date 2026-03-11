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
    isStable: Joi.boolean(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Create Pool Argument Validation Error: " + error.message);
  }
}

export function validateAddLiquidityDualTokenArgs(args: any) {
  const schema = Joi.object({
    tokenBAmount: numericStringField("TokenBAmount").required(),
    maxTokenAAmount: numericStringField("MaxTokenAAmount").required(),
    stakeLPToken: Joi.boolean().optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Add Liquidity Dual Token Argument Validation Error: " + error.message);
  }
}

export function validateAddLiquiditySingleTokenArgs(args: any) {
  const schema = Joi.object({
    singleTokenAmount: numericStringField("SingleTokenAmount").required(),
    isAToB: Joi.boolean().required(),
    stakeLPToken: Joi.boolean().optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Add Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateRemoveLiquidityArgs(args: any) {
  const schema = Joi.object({
    lpTokenAmount: numericStringField("LpTokenAmount"),
    includeStakedLPToken: Joi.boolean().optional(),
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

export function validateTogglePauseArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress"),
    isPaused: Joi.boolean().required(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Toggle Pause Argument Validation Error: " + error.message);
  }
}

export function validateToggleDisableArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress"),
    isDisabled: Joi.boolean().required(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Toggle Disable Argument Validation Error: " + error.message);
  }
}

export function validateMultiTokenSwapArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress"),
    tokenIn: validateAddressField("tokenIn"),
    tokenOut: validateAddressField("tokenOut"),
    amountIn: numericStringField("AmountIn"),
    minAmountOut: numericStringField("MinAmountOut"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Multi-Token Swap Argument Validation Error: " + error.message);
  }
}

export function validateMultiTokenAddLiquidityArgs(args: any) {
  const schema = Joi.object({
    amounts: Joi.array().items(numericStringField("amount")).min(1).required(),
    minMintAmount: numericStringField("MinMintAmount"),
    stakeLPToken: Joi.boolean().optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Multi-Token Add Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateMultiTokenRemoveLiquidityArgs(args: any) {
  const schema = Joi.object({
    lpTokenAmount: numericStringField("LpTokenAmount"),
    minAmounts: Joi.array().items(numericStringField("minAmount")).min(1).required(),
    includeStakedLPToken: Joi.boolean().optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Multi-Token Remove Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateMultiTokenRemoveLiquidityOneArgs(args: any) {
  const schema = Joi.object({
    lpTokenAmount: numericStringField("LpTokenAmount"),
    coinIndex: Joi.number().integer().min(0).required(),
    minReceived: numericStringField("MinReceived"),
    includeStakedLPToken: Joi.boolean().optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Multi-Token Remove Liquidity One Coin Argument Validation Error: " + error.message);
  }
}

export function validateSetPoolRatesArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress"),
    swapFeeRate: Joi.number().min(0).max(10000).required(), // 0-100% with 2 decimals (10000 = 100%)
    lpSharePercent: Joi.number().min(0).max(10000).required(), // 0-100% with 2 decimals (10000 = 100%)
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Set Pool Rates Argument Validation Error: " + error.message);
  }
}