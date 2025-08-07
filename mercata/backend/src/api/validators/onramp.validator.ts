import Joi from "@hapi/joi";
export function validateBuyArgs(args: any) {

  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  // First validate required fields are present
  const baseSchema = Joi.object({
    token: Joi.string().required(),
    amount: Joi.string().required(),
    paymentProviderAddress: Joi.string().required(),
  }).strict();

  const { error: baseError } = baseSchema.validate(args);
  if (baseError) {
    throw new Error("Buy Argument Validation Error: " + baseError.message);
  }

  // Post-normalization validation
  const finalSchema = Joi.object({
    token: Joi.string()
      .pattern(/^[a-fA-F0-9]{40}$/)
      .required()
      .messages({
        "string.pattern.base": "Token address must be a valid Ethereum address.",
      }),
    amount: Joi.string()
      .pattern(/^\d+$/)
      .required()
      .custom((value, helpers) => {
        const big = BigInt(value);
        if (big <= 0n) {
          return helpers.error("any.invalid");
        }
        return value;
      }, "Positive amount check")
      .messages({
        "string.pattern.base": "Amount must be a numeric string.",
        "any.invalid": "Amount must be greater than 0.",
      }),
    paymentProviderAddress: Joi.string()
      .pattern(/^[a-fA-F0-9]{40}$/)
      .required()
      .messages({
        "string.pattern.base": "Payment provider address must be a valid Ethereum address.",
      }),
  }).strict();

  const { error } = finalSchema.validate(args);
  if (error) {
    throw new Error("Buy Argument Validation Error: " + error.message);
  }
}

export function validateSellArgs(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  // Step 1: Initial basic validation
  const baseSchema = Joi.object({
    token: Joi.string().required(),
    amount: Joi.string().required(),
    marginBps: Joi.string().required(),
    providerAddresses: Joi.array().items(Joi.string().required()).min(1).required(),
  }).strict();

  const { error: baseError } = baseSchema.validate(args);
  if (baseError) {
    throw new Error("Sell Argument Validation Error: " + baseError.message);
  }

  const finalSchema = Joi.object({
    token: Joi.string()
      .pattern(/^[a-fA-F0-9]{40}$/)
      .required()
      .messages({
        "string.pattern.base": "Token address must be a valid Ethereum address.",
      }),

    amount: Joi.string()
      .pattern(/^\d+$/)
      .required()
      .custom((value, helpers) => {
        if (BigInt(value) <= 0n) return helpers.error("any.invalid");
        return value;
      }, "positive amount check")
      .messages({
        "string.pattern.base": "Amount must be a numeric string.",
        "any.invalid": "Amount must be greater than 0.",
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
          .pattern(/^[a-fA-F0-9]{40}$/)
          .messages({
            "string.pattern.base": "Each provider address must be a valid Ethereum address.",
          })
      )
      .required()
      .min(1)
      .messages({
        "array.base": "Provider addresses must be an array.",
        "array.min": "At least one provider address is required.",
      }),
  }).strict();

  const { error } = finalSchema.validate(args);
  if (error) {
    throw new Error("Sell Argument Validation Error: " + error.message);
  }
}