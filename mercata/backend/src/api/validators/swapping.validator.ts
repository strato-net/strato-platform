import Joi from "@hapi/joi";

// Validator functions
export function validatePoolAddressArgs(args: any) {
  const schema = Joi.object({
    poolAddress: Joi.string().required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Pool Address Argument Validation Error");
  }
}

export function validateTokenAddressArgs(args: any) {
  const schema = Joi.object({
    tokenAddress: Joi.string().required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Token Address Argument Validation Error");
  }
}

export function validateTokenPairArgs(args: any) {
  const schema = Joi.object({
    tokenAddress1: Joi.string().required(),
    tokenAddress2: Joi.string().required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Token Pair Argument Validation Error");
  }
}

export function validateCreatePoolsArgs(args: any) {
  const schema = Joi.object({
    tokenA: Joi.string().required(),
    tokenB: Joi.string().required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Create Pool Argument Validation Error: " + error.message);
  }
}

export function validateAddLiquidityArgs(args: any) {
  const schema = Joi.object({
    tokenBAmount: Joi.string().required(),
    maxTokenAAmount: Joi.string().required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Add Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateRemoveLiquidityArgs(args: any) {
  const schema = Joi.object({
    lpTokenAmount: Joi.string().required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Remove Liquidity Argument Validation Error: " + error.message);
  }
}

export function validateSwapArgs(args: any) {
  const schema = Joi.object({
    poolAddress: Joi.string().required(),
    isAToB: Joi.boolean().required(),
    amountIn: Joi.string().required(),
    minAmountOut: Joi.string().required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Swap Argument Validation Error: " + error.message);
  }
}

export function validateCalculateSwapArgs(args: any) {
  const schema = Joi.object({
    poolAddress: Joi.string().required(),
    isAToB: Joi.string().valid("true", "false").required(),
    amountIn: Joi.string().required(),
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
    poolAddress: Joi.string().required(),
  });
  
  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Swap History Argument Validation Error: " + error.message);
  }
}