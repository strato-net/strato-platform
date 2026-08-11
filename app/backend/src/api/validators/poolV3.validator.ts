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

export function validatePoolV3MintArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress").required(),
    tickLower: tickField.required(),
    tickUpper: tickField.required(),
    // Canonical desired/min parameters (PositionManagerV3 computes liquidity on-chain).
    // A single-sided (out-of-range) position deposits only one token, so the unused
    // side's desired amount is legitimately "0" — but not both.
    amount0Desired: numericStringField("amount0Desired", { allowZero: true }).required(),
    amount1Desired: numericStringField("amount1Desired", { allowZero: true }).required(),
    amount0Min: numericStringField("amount0Min", { allowZero: true }).optional(),
    amount1Min: numericStringField("amount1Min", { allowZero: true }).optional(),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Mint Argument Validation Error: " + error.message);
  if (BigInt(args.amount0Desired) === 0n && BigInt(args.amount1Desired) === 0n) {
    throw new Error("PoolV3 Mint Argument Validation Error: at least one desired amount must be positive");
  }
}

export function validatePoolV3IncreaseArgs(args: any) {
  const schema = Joi.object({
    tokenId: numericStringField("tokenId").required(),
    amount0Desired: numericStringField("amount0Desired", { allowZero: true }).required(),
    amount1Desired: numericStringField("amount1Desired", { allowZero: true }).required(),
    amount0Min: numericStringField("amount0Min", { allowZero: true }).optional(),
    amount1Min: numericStringField("amount1Min", { allowZero: true }).optional(),
  });
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Increase Argument Validation Error: " + error.message);
  if (BigInt(args.amount0Desired) === 0n && BigInt(args.amount1Desired) === 0n) {
    throw new Error("PoolV3 Increase Argument Validation Error: at least one desired amount must be positive");
  }
}

export function validatePoolV3BurnArgs(args: any) {
  // Two addressing modes: `tokenId` (position NFTs, managed by PositionManagerV3) or
  // poolAddress + ticks (legacy positions held directly on the pool) — exactly one.
  const schema = Joi.object({
    tokenId: numericStringField("tokenId").optional(),
    poolAddress: validateAddressField("poolAddress").optional(),
    tickLower: tickField.optional(),
    tickUpper: tickField.optional(),
    // NFT path: the manager requires liquidity > 0 (collect covers fee claiming).
    // Legacy path allowZero: burn(0) is a valid "poke" — it accrues fees into the
    // position's tokensOwed without removing liquidity; paired with collect:true this
    // realizes and claims accrued fees (the periphery collect() pattern).
    liquidity: Joi.when("tokenId", {
      is: Joi.exist(),
      then: numericStringField("liquidity").required(),
      otherwise: numericStringField("liquidity", { allowZero: true }).required(),
    }),
    amount0Min: numericStringField("amount0Min", { allowZero: true }).optional(),
    amount1Min: numericStringField("amount1Min", { allowZero: true }).optional(),
    collect: Joi.boolean(),
  })
    .xor("tokenId", "poolAddress")
    .with("poolAddress", ["tickLower", "tickUpper"])
    .without("tokenId", ["tickLower", "tickUpper"]);
  const { error } = schema.validate(args);
  if (error) throw new Error("PoolV3 Burn Argument Validation Error: " + error.message);
}

export function validatePoolV3CollectArgs(args: any) {
  // Same dual addressing as burn: tokenId (NFT) or poolAddress + ticks (legacy).
  const schema = Joi.object({
    tokenId: numericStringField("tokenId").optional(),
    poolAddress: validateAddressField("poolAddress").optional(),
    tickLower: tickField.optional(),
    tickUpper: tickField.optional(),
    // Both optional: the service defaults each to uint128-max (collect everything owed).
    // allowZero so a caller can explicitly request zero of one side.
    amount0Requested: numericStringField("amount0Requested", { allowZero: true }).optional(),
    amount1Requested: numericStringField("amount1Requested", { allowZero: true }).optional(),
  })
    .xor("tokenId", "poolAddress")
    .with("poolAddress", ["tickLower", "tickUpper"])
    .without("tokenId", ["tickLower", "tickUpper"]);
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
