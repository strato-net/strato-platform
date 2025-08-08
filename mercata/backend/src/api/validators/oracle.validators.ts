import Joi from "@hapi/joi";
import { ethereumAddressField, numericStringField } from "./common.validators";

export function validateGetPriceQuery(query: any) {
  const schema = Joi.object({
    asset: ethereumAddressField("asset"),
  })

  const { error, value } = schema.validate(query, { abortEarly: false });

  if (error) {
    throw new Error(error.details.map((d) => d.message).join(", "));
  }

  return value;
}

export function validateSetPriceInput(body: any) {
  const schema = Joi.object({
    token: ethereumAddressField("token"),
    price: numericStringField("price"),
  });

  const { error, value } = schema.validate(body);
  if (error) {
    throw new Error(`Invalid input: ${error.message}`);
  }
  return value;
}

export const validateGetPriceHistoryInput = (
  assetAddress: string,
) => {
  const paramsSchema = Joi.object({
    assetAddress: ethereumAddressField("assetAddress"),
  });

  const paramValidation = paramsSchema.validate({ assetAddress });
  if (paramValidation.error) {
    throw new Error(paramValidation.error.details[0].message);
  }

  return {
    assetAddress: paramValidation.value.assetAddress,
  };
};

