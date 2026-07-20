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
  // Callers supply exactly one of: liquidity (L -> both token amounts), amount0Desired,
  // or amount1Desired (one token amount + range -> L and the other amount). numericStringField
  // is .required() by default, so each is made .optional() here and `.or(...)` enforces that at
  // least one is present — otherwise the schema would (wrongly) demand all three.
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress").required(),
    tickLower: Joi.number().integer().required(),
    tickUpper: Joi.number().integer().required(),
    liquidity: numericStringField("liquidity").optional(),
    amount0Desired: numericStringField("amount0Desired").optional(),
    amount1Desired: numericStringField("amount1Desired").optional(),
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
    // Optional price limit; the service defaults it to "0" (swap to the tick-domain edge),
    // so it must be omittable AND accept the "0" sentinel (allowZero).
    sqrtPriceLimitX96: numericStringField("sqrtPriceLimitX96", { allowZero: true }).optional(),
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
    // A single-sided (out-of-range) position deposits only one token, so the unused side's
    // max is legitimately "0" — allow zero here (a zero ceiling for a token that isn't
    // deposited is correct: 0 deposited <= 0 max).
    amount0Max: numericStringField("amount0Max", { allowZero: true }).required(),
    amount1Max: numericStringField("amount1Max", { allowZero: true }).required(),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Mint Argument Validation Error: " + error.message);
}

export function validatePoolV3BurnArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress").required(),
    tickLower: tickField.required(),
    tickUpper: tickField.required(),
    // allowZero: burn(0) is a valid "poke" — it accrues fees into the position's tokensOwed
    // without removing liquidity. Paired with collect:true this realizes and claims accrued
    // fees (the periphery collect() pattern), which is how the app surfaces fees given the
    // indexer can't expose live feeGrowthInside from Cirrus.
    liquidity: numericStringField("liquidity", { allowZero: true }).required(),
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
    // Both optional: the service defaults each to uint128-max (collect everything owed).
    // allowZero so a caller can explicitly request zero of one side.
    amount0Requested: numericStringField("amount0Requested", { allowZero: true }).optional(),
    amount1Requested: numericStringField("amount1Requested", { allowZero: true }).optional(),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Collect Argument Validation Error: " + error.message);
}

export function validatePoolV3CreateArgs(args: any) {
  // Accept either a raw Q64.96 sqrt price or a human-readable price (converted server-side
  // from each token's decimals). Exactly one is required — `.or(...)` enforces at-least-one.
  const schema = Joi.object({
    tokenA: validateAddressField("tokenA").required(),
    tokenB: validateAddressField("tokenB").required(),
    fee: Joi.number().integer().min(1).max(999999).required(),
    initialSqrtPriceX96: numericStringField("initialSqrtPriceX96").optional(),
    price: numericStringField("price").optional(),
  })
    .or("initialSqrtPriceX96", "price");
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Create Argument Validation Error: " + error.message);
}
