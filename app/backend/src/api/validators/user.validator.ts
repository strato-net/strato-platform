import Joi from "@hapi/joi";
import { numericStringField } from "./common.validators";

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

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateExecutedLookup(body: any): { calls: Array<{ target: string; func: string }>; contracts: string[] } {
  const schema = Joi.object({
    calls: Joi.array().max(50).items(Joi.object({
      target: Joi.string().pattern(/^(0x)?[0-9a-fA-F]{40}$/).required(),
      func: Joi.string().pattern(IDENTIFIER).required(),
    })).default([]),
    contracts: Joi.array().max(50).items(Joi.string().pattern(IDENTIFIER)).default([]),
  });

  const { error, value } = schema.validate(body);

  if (error) {
    throw new Error("Executed Lookup Validation Error: " + error.message);
  }
  return value;
}
