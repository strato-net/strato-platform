import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getOwnedNFTs,
  getCollections,
  getCollection,
  getNFTItem,
  transferNFT,
  burnNFT,
} from "../services/nfts.service";
import {
  validateCollectionAddressArgs,
  validateItemParams,
  validateTransferArgs,
  validateBurnArgs,
  validateQueryParams,
} from "../validators/nfts.validator";

class NFTsController {
  static async getOwned(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, address: userAddress } = req;
      const owned = await getOwnedNFTs(accessToken, userAddress as string);
      res.status(RestStatus.OK).json(owned);
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, query } = req;
      validateQueryParams(query);
      const collections = await getCollections(
        accessToken,
        query as Record<string, string | undefined>
      );
      res.status(RestStatus.OK).json(collections);
    } catch (error) {
      next(error);
    }
  }

  static async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params, query } = req;
      validateCollectionAddressArgs(params);
      const collection = await getCollection(accessToken, params.address, {
        limit: query.limit as string | undefined,
        offset: query.offset as string | undefined,
      });
      res.status(RestStatus.OK).json(collection);
    } catch (error) {
      next(error);
    }
  }

  static async getItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken, params } = req;
      validateItemParams(params);
      const item = await getNFTItem(accessToken, params.address, params.tokenId);
      res.status(RestStatus.OK).json(item);
    } catch (error) {
      next(error);
    }
  }

  static async transfer(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body, params, address: userAddress } = req;
      validateCollectionAddressArgs(params);
      validateTransferArgs(body);
      const result = await transferNFT(accessToken, userAddress as string, params.address, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async burn(req: Request, res: Response, next: NextFunction) {
    try {
      const { accessToken, body, params, address: userAddress } = req;
      validateCollectionAddressArgs(params);
      validateBurnArgs(body);
      const result = await burnNFT(accessToken, userAddress as string, params.address, body);
      res.status(RestStatus.OK).json(result);
      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default NFTsController;
