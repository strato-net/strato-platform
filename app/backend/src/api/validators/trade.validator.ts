import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

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
