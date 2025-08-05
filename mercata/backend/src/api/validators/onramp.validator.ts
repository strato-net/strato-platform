import Joi from "@hapi/joi";
import { normalizeAddress } from "../../utils/utils";
export function validateBuyArgs(args: any) {
  args.token = normalizeAddress(args.token);
  args.paymentProviderAddress = normalizeAddress(args.paymentProviderAddress);

  const schema = Joi.object({
    token: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(), // Ethereum address
    amount: Joi.string().pattern(/^\d+$/).required(),
    paymentProviderAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
  }).strict();

  const { error } = schema.validate(args);
  if (error) throw new Error("Buy Argument Validation Error: " + error.message);

  if (BigInt(args.amount) <= 0n) {
    throw new Error("Amount must be a positive integer");
  }
}

export function validateSellArgs(args: any) {
  args.token = normalizeAddress(args.token);
  args.providerAddresses = args.providerAddresses.map(normalizeAddress);
  const schema = Joi.object({
    token: Joi.string()
      .pattern(/^0x[a-fA-F0-9]{40}$/)
      .required()
      .messages({
        "string.pattern.base": "Token address must be a valid 0x-prefixed Ethereum address.",
      }),

    amount: Joi.string()
      .pattern(/^\d+$/)
      .required()
      .messages({
        "string.pattern.base": "Amount must be a numeric string.",
      }),

    marginBps: Joi.string()
      .pattern(/^\d+$/)
      .required()
      .custom((value, helpers) => {
        const bps = BigInt(value);
        if (bps < 0n || bps > 10000n) {
          return helpers.error("any.invalid");
        }
        return value;
      }, "marginBps range check")
      .messages({
        "any.invalid": "Margin (bps) must be between 0 and 10000.",
      }),

    providerAddresses: Joi.array()
      .items(
        Joi.string()
          .pattern(/^0x[a-fA-F0-9]{40}$/)
          .messages({
            "string.pattern.base": "Each provider address must be a valid 0x-prefixed Ethereum address.",
          })
      )
      .required()
      .min(1)
      .messages({
        "array.base": "Provider addresses must be an array.",
        "array.min": "At least one provider address is required.",
      }),
  }).strict();

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Sell Argument Validation Error: " + error.message);
  }

  if (BigInt(args.amount) <= 0n) {
    throw new Error("Amount must be a positive value.");
  }
}