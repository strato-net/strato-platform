import Joi from "@hapi/joi";

// Schema definitions
const addressSchema = Joi.object({
  address: Joi.string().required(),
});

const createPoolsSchema = Joi.object({
  tokenA: Joi.string().required(),
  tokenB: Joi.string().required(),
});

const addLiquiditySchema = Joi.object({
  address: Joi.string().required(),
  tokenB_amount: Joi.string().required(),
  max_tokenA_amount: Joi.string().required(),
});

const removeLiquiditySchema = Joi.object({
  address: Joi.string().required(),
  amount: Joi.string().required(),
  // min_tokenB: Joi.string().required(),
  // min_tokenA_amount: Joi.string().required(),
});

const swapSchema = Joi.object({
  address: Joi.string().required(),
  method: Joi.string().valid("tokenAToTokenB", "tokenBToTokenA").required(),
  amount: Joi.string().required(),
  min_tokens: Joi.string().required(),
});

const queryParamsSchema = Joi.object().pattern(Joi.string(), Joi.string());

// Validator functions
export function validateAddressArgs(args: any) {
  const { error } = addressSchema.validate(args);
  if (error) {
    throw new Error("Address Argument Validation Error");
  }
}

export function validateCreatePoolsArgs(args: any) {
  const { error } = createPoolsSchema.validate(args);
  if (error) {
    throw new Error("Create Pool Argument Validation Error: " + error.message);
  }
}

export function validateAddLiquidityArgs(args: any) {
  const { error } = addLiquiditySchema.validate(args);
  if (error) {
    throw new Error("Add Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateRemoveLiquidityArgs(args: any) {
  const { error } = removeLiquiditySchema.validate(args);
  if (error) {
    throw new Error("Remove Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateSwapArgs(args: any) {
  const { error } = swapSchema.validate(args);
  if (error) {
    throw new Error("Swap Argument Validation Error: " + error.message);
  }
}

export function validateQueryParams(query: any) {
  const { error } = queryParamsSchema.validate(query);
  if (error) {
    throw new Error("Query Parameter Validation Error: " + error.message);
  }
}