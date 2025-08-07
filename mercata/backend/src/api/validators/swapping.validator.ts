import Joi from "@hapi/joi";
import { ethereumAddressField } from "./common.validators";

const numericString = (label: string) =>
  Joi.string()
    .pattern(/^\d+$/)
    .required()
    .messages({
      "string.pattern.base": `${label} must be a numeric string (integers only)`,
      "any.required": `${label} is required`,
    });


// Validator functions
export function validatePoolAddressArgs(args: any) {
  const schema = Joi.object({
    poolAddress: ethereumAddressField.label("poolAddress"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Pool Address Argument Validation Error: " + error.message);
  }
}

export function validateTokenAddressArgs(args: any) {
  const schema = Joi.object({
    tokenAddress: ethereumAddressField.label("tokenAddress"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Token Address Argument Validation Error:" + error.message);
  }
}

export function validateTokenPairArgs(args: any) {
  const schema = Joi.object({
    tokenAddress1: ethereumAddressField.label("tokenAddress1"),
    tokenAddress2: ethereumAddressField.label("tokenAddress2"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Token Pair Argument Validation Error:" + error.message);
  }
}

export function validateCreatePoolsArgs(args: any) {
  const schema = Joi.object({
    tokenA: ethereumAddressField.label("tokenA"),
    tokenB: ethereumAddressField.label("tokenB"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Create Pool Argument Validation Error: " + error.message);
  }
}

export function validateAddLiquidityArgs(args: any) {
  const schema = Joi.object({
    tokenBAmount: numericString("TokenBAmount"),
    maxTokenAAmount: numericString("MaxTokenAAmount"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Add Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateRemoveLiquidityArgs(args: any) {
  const schema = Joi.object({
    lpTokenAmount: numericString("LpTokenAmount"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Remove Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateSwapArgs(args: any) {
  const schema = Joi.object({
    poolAddress: ethereumAddressField.label("poolAddress"),
    isAToB: Joi.boolean().required(),
    amountIn: numericString("AmountIn"),
    minAmountOut: numericString("MinAmountOut"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Swap Argument Validation Error: " + error.message);
  }
}

export function validateCalculateSwapArgs(args: any) {
  const schema = Joi.object({
    poolAddress: ethereumAddressField.label("poolAddress"),
    isAToB: Joi.string().valid("true", "false").required(),
    amountIn: numericString("AmountIn"),
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
    poolAddress: ethereumAddressField.label("poolAddress"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Swap History Argument Validation Error: " + error.message);
  }
}