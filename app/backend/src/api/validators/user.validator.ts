import Joi from "joi";
import { StatusCodes } from "http-status-codes";
import { numericStringField } from "./common.validators";

// A partner referral claim by an external wallet (refer.controller). The
// address is the X-Wallet-Address header; issuedAt is the exact time string
// the backend issued, so that the signed message can be rebuilt from it.
const partnerClaimSchema = Joi.object({
  address: Joi.string().pattern(/^(0x)?[0-9a-fA-F]{40}$/).required(),
  code: Joi.string().pattern(/^[A-Za-z0-9]{1,32}$/).required(),
  issuedAt: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  signature: Joi.string().pattern(/^0x[0-9a-fA-F]{130}$/),
});

/** Checks a claim's fields and returns them as the service takes them: address without 0x in lowercase, code in upper case. */
export function validatePartnerClaim(args: { address: unknown; code: unknown; issuedAt?: unknown; signature?: unknown }, signed: boolean) {
  const { error, value } = partnerClaimSchema.fork(["issuedAt", "signature"], (field) => (signed ? field.required() : field.forbidden())).validate(args);
  if (error) {
    throw Object.assign(new Error("Partner Claim Validation Error: " + error.message), { statusCode: StatusCodes.BAD_REQUEST });
  }
  return { ...value, address: value.address.replace(/^0x/i, "").toLowerCase(), code: value.code.toUpperCase() } as {
    address: string;
    code: string;
    issuedAt: string;
    signature: string;
  };
}

export function validateIssuesQuery(query: any) {
  const schema = Joi.object({
    page: numericStringField("page").optional().default("1").custom((value, helpers) => {
      const num = parseInt(value, 10);
      if (num < 1) {
        return helpers.error("number.min");
      }
      return value;
    }).messages({
      "number.min": '"page" must be at least 1',
    }),
    limit: numericStringField("limit").optional().default("10").custom((value, helpers) => {
      const num = parseInt(value, 10);
      if (num < 1 || num > 100) {
        return helpers.error("number.range");
      }
      return value;
    }).messages({
      "number.range": '"limit" must be between 1 and 100',
    }),
  });

  const { error } = schema.validate(query);

  if (error) {
    throw new Error("Issues Query Validation Error: " + error.message);
  }
}
