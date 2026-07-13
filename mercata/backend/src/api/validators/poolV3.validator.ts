import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

const signedNumericStringField = (name: string) =>
  Joi.string()
    .pattern(/^-?\d+$/)
    .error(new Error(`${name} must be a signed integer string`));

const tickField = Joi.number().integer().min(-887272).max(887272);

export function validatePoolV3AddressArgs(args: any) {
  const schema = Joi.object({ poolAddress: validateAddressField("poolAddress") });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Address Argument Validation Error: " + error.message);
}

export function validatePoolV3PairArgs(args: any) {
  const schema = Joi.object({
    tokenAddress1: validateAddressField("tokenAddress1"),
    tokenAddress2: validateAddressField("tokenAddress2"),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Pair Argument Validation Error: " + error.message);
}

export function validatePoolV3QuoteArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress").required(),
    zeroForOne: Joi.string().valid("true", "false").required(),
    amountSpecified: signedNumericStringField("amountSpecified").required(),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Quote Argument Validation Error: " + error.message);
}

export function validatePoolV3AmountsArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress").required(),
    tickLower: Joi.number().integer().required(),
    tickUpper: Joi.number().integer().required(),
    liquidity: numericStringField("liquidity"),
    amount0Desired: numericStringField("amount0Desired"),
    amount1Desired: numericStringField("amount1Desired"),
  })
    .or("liquidity", "amount0Desired", "amount1Desired");
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Amounts Argument Validation Error: " + error.message);
}

export function validatePoolV3SwapArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress").required(),
    zeroForOne: Joi.boolean().required(),
    amountSpecified: signedNumericStringField("amountSpecified").required(),
    amountLimit: numericStringField("amountLimit").required(),
    sqrtPriceLimitX96: numericStringField("sqrtPriceLimitX96"),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Swap Argument Validation Error: " + error.message);
}

export function validatePoolV3MintArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress").required(),
    tickLower: tickField.required(),
    tickUpper: tickField.required(),
    liquidity: numericStringField("liquidity").required(),
    amount0Max: numericStringField("amount0Max").required(),
    amount1Max: numericStringField("amount1Max").required(),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Mint Argument Validation Error: " + error.message);
}

export function validatePoolV3BurnArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress").required(),
    tickLower: tickField.required(),
    tickUpper: tickField.required(),
    liquidity: numericStringField("liquidity").required(),
    collect: Joi.boolean(),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Burn Argument Validation Error: " + error.message);
}

export function validatePoolV3CollectArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress").required(),
    tickLower: tickField.required(),
    tickUpper: tickField.required(),
    amount0Requested: numericStringField("amount0Requested"),
    amount1Requested: numericStringField("amount1Requested"),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Collect Argument Validation Error: " + error.message);
}

export function validatePoolV3CreateArgs(args: any) {
  const schema = Joi.object({
    tokenA: validateAddressField("tokenA").required(),
    tokenB: validateAddressField("tokenB").required(),
    fee: Joi.number().integer().min(1).max(999999).required(),
    initialSqrtPriceX96: numericStringField("initialSqrtPriceX96").required(),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Create Argument Validation Error: " + error.message);
}
