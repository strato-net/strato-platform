import Joi from "@hapi/joi";
import { validateAddressField, numericStringField, uintStringField } from "./common.validators";

export function validateTradeTokenArgs(args: any) {
  const schema = Joi.object({
    tokenAddress: validateAddressField("tokenAddress"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Trade Token Argument Validation Error: " + error.message);
  }
}

export function validateTradePairArgs(args: any) {
  const schema = Joi.object({
    tokenAddress1: validateAddressField("tokenAddress1"),
    tokenAddress2: validateAddressField("tokenAddress2"),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Trade Pair Argument Validation Error: " + error.message);
  }
}

export function validateTradeQuoteArgs(args: any) {
  const schema = Joi.object({
    tokenIn: validateAddressField("tokenIn").required(),
    tokenOut: validateAddressField("tokenOut").required(),
    amount: numericStringField("amount").required(),
    type: Joi.string().valid("EXACT_INPUT", "EXACT_OUTPUT").required(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Trade Quote Argument Validation Error: " + error.message);
  }
  if (String(args.tokenIn).toLowerCase() === String(args.tokenOut).toLowerCase()) {
    throw new Error("Trade Quote Argument Validation Error: tokenIn and tokenOut must differ");
  }
}

export function validateTradeSwapArgs(args: any) {
  const schema = Joi.object({
    poolAddress: validateAddressField("poolAddress").required(),
    tokenIn: validateAddressField("tokenIn").required(),
    tokenOut: validateAddressField("tokenOut").required(),
    amountIn: numericStringField("amountIn").required(),
    minAmountOut: numericStringField("minAmountOut").required(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Trade Swap Argument Validation Error: " + error.message);
  }
}

export function validateRouteQuoteArgs(args: any) {
  const schema = Joi.object({
    tokenIn: validateAddressField("tokenIn").required(),
    tokenOut: validateAddressField("tokenOut").required(),
    amount: uintStringField("amount"),
    slippageBps: Joi.number().integer().min(0).max(9999).optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Route Quote Argument Validation Error: " + error.message);
  }
  if (String(args.tokenIn).toLowerCase() === String(args.tokenOut).toLowerCase()) {
    throw new Error("Route Quote Argument Validation Error: tokenIn and tokenOut must differ");
  }
}

export function validateCompositeRouteQuoteArgs(args: any) {
  const schema = Joi.object({
    externalChainId: uintStringField("externalChainId"),
    externalToken: validateAddressField("externalToken").required(),
    targetStratoToken: validateAddressField("targetStratoToken").required(),
    tokenOut: validateAddressField("tokenOut").required(),
    amount: uintStringField("amount"),
    slippageBps: Joi.number().integer().min(0).max(9999).optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Composite Route Quote Argument Validation Error: " + error.message);
  }
}

export function validateRouteExecuteArgs(args: any) {
  const schema = Joi.object({
    tokenIn: validateAddressField("tokenIn").required(),
    tokenOut: validateAddressField("tokenOut").required(),
    amountIn: uintStringField("amountIn"),
    minFinalOut: uintStringField("minFinalOut"),
    slippageBps: Joi.number().integer().min(0).max(9999).optional(),
    recipient: validateAddressField("recipient").optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Route Execute Argument Validation Error: " + error.message);
  }
  if (String(args.tokenIn).toLowerCase() === String(args.tokenOut).toLowerCase()) {
    throw new Error("Route Execute Argument Validation Error: tokenIn and tokenOut must differ");
  }
}

export function validateTradeHistoryQuery(args: any) {
  const schema = Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    sender: validateAddressField("sender").optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Trade History Argument Validation Error: " + error.message);
  }
}
