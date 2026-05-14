import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

const throwOnError = (label: string, error: Joi.ValidationError | undefined) => {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
};

export function validateBuyArgs(args: any) {
  const schema = Joi.object({
    paymentToken: validateAddressField("paymentToken"),
    saleAmount: numericStringField("saleAmount"),
    paymentAmount: numericStringField("paymentAmount"),
  });
  throwOnError("FixedPriceSale Buy Argument Validation Error", schema.validate(args).error);
}

export function validateQuoteArgs(args: any) {
  const schema = Joi.object({
    paymentToken: validateAddressField("paymentToken"),
    saleAmount: numericStringField("saleAmount"),
  });
  throwOnError("FixedPriceSale Quote Argument Validation Error", schema.validate(args).error);
}

export function validatePaymentTokenArgs(args: any) {
  const schema = Joi.object({
    paymentToken: validateAddressField("paymentToken"),
  });
  throwOnError("FixedPriceSale Payment Token Argument Validation Error", schema.validate(args).error);
}

export function validateSetPriceArgs(args: any) {
  const schema = Joi.object({
    pricePerTokenUSD: numericStringField("pricePerTokenUSD"),
  });
  throwOnError("FixedPriceSale Set Price Argument Validation Error", schema.validate(args).error);
}

export function validateSetHardCapArgs(args: any) {
  const schema = Joi.object({
    hardCap: numericStringField("hardCap"),
  });
  throwOnError("FixedPriceSale Set Hard Cap Argument Validation Error", schema.validate(args).error);
}

export function validateSetPerWalletCapArgs(args: any) {
  const schema = Joi.object({
    perWalletCap: numericStringField("perWalletCap", { allowZero: true }),
  });
  throwOnError("FixedPriceSale Set Per Wallet Cap Argument Validation Error", schema.validate(args).error);
}

export function validateSetScheduleArgs(args: any) {
  const schema = Joi.object({
    startTime: numericStringField("startTime", { allowZero: true }),
    endTime: numericStringField("endTime"),
  });
  throwOnError("FixedPriceSale Set Schedule Argument Validation Error", schema.validate(args).error);
}

export function validateSweepProceedsArgs(args: any) {
  const schema = Joi.object({
    paymentToken: validateAddressField("paymentToken"),
    to: validateAddressField("to"),
    amount: numericStringField("amount"),
  });
  throwOnError("FixedPriceSale Sweep Proceeds Argument Validation Error", schema.validate(args).error);
}

export function validateSweepUnsoldArgs(args: any) {
  const schema = Joi.object({
    to: validateAddressField("to"),
  });
  throwOnError("FixedPriceSale Sweep Unsold Argument Validation Error", schema.validate(args).error);
}
