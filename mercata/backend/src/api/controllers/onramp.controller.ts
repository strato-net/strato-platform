import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { get, sell, buy, addPaymentProvider, removePaymentProvider, cancelListing, updateListing } from "../services/onramp.service";
import { validateBuyArgs, validateSellArgs, validateAddPaymentProviderArgs, validateRemovePaymentProviderArgs, validateUpdateListingArgs } from "../validators/onramp.validator";

class OnRampController {
  static async get(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;

      const token = await get(accessToken);
      res.status(RestStatus.OK).json(token);
    } catch (error) {
      next(error);
    }
  }

  static async sell(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateSellArgs(body);

      const result = await sell(accessToken, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async buy(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    try {
      const { accessToken, address, body } = req;
      validateBuyArgs(body)

      const result = await buy(accessToken, address, body);

      res.status(RestStatus.OK).json({ url: result.url });
    } catch (error) {
      next(error);
    }
  }

  static async addPaymentProvider(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateAddPaymentProviderArgs(body);

      const result = await addPaymentProvider(accessToken, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async removePaymentProvider(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateRemovePaymentProviderArgs(body);

      const result = await removePaymentProvider(accessToken, body.providerAddress);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async cancelListing(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      // Validate that token is provided
      if (!body.token) {
        throw new Error("Token address is required");
      }

      const result = await cancelListing(accessToken, body.token);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async updateListing(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateUpdateListingArgs(body);

      const result = await updateListing(accessToken, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
  
}

export default OnRampController;
