import Joi from "@hapi/joi";
import { numericStringField } from "./common.validators";

export function validateExecutedIssuesQuery(query: any) {
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
    throw new Error("Executed Issues Query Validation Error: " + error.message);
  }
}
