import { rest } from "blockapps-rest";
import Joi from "@hapi/joi";
import RestStatus from "http-status-codes";
import config from "../../../load.config";
import constants from "../../../helpers/constants";
import { getSignedUrlFromS3 } from "../../../helpers/s3";

const options = { config, cacheNonce: true };

class MarketplaceController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;
      if (query.manufacturer) {
        const encodedManufacturers = query.manufacturer.map((product) => {
          return encodeURIComponent(product);
        });
        query.manufacturer = encodedManufacturers;
      }
      let inventories = await dapp.getMarketplaceInventories({ ...query });

      // const productsWithImageUrl = inventories
      //   .map(product => ({
      //     ...product,
      //     imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName))
      //   }))

      inventories = inventories.map((inventory) => {
        let img = "";
        if (
          inventory.productImageLocation !== null &&
          inventory.productImageLocation !== undefined &&
          inventory?.productImageLocation?.length > 0
        ) {
          img = inventory.productImageLocation.map((item) => {
            return getSignedUrlFromS3(item, req.app.get(constants.s3ParamName));
          });
        }
        return { ...inventory, productImageLocation: img };
      });
      rest.response.status200(res, inventories);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAllLoggedIn(req, res, next) {
    try {
      const { dapp, query } = req;

      if (query.manufacturer) {
        const encodedManufacturers = query.manufacturer.map((product) => {
          return encodeURIComponent(product);
        });
        query.manufacturer = encodedManufacturers;
      }
      let inventories = await dapp.getMarketplaceInventoriesLoggedIn({
        ...query,
      });

      inventories = inventories.map((inventory) => {
        let img = "";
        if (
          inventory.productImageLocation !== null &&
          inventory.productImageLocation !== undefined &&
          inventory?.productImageLocation?.length > 0
        ) {
          img = inventory.productImageLocation.map((item) => {
            return getSignedUrlFromS3(item, req.app.get(constants.s3ParamName));
          });
        }
        return { ...inventory, productImageLocation: img };
      });

      // const productsWithImageUrl = inventories
      //   .map(product => ({
      //     ...product,
      //     imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName))
      //   }))
      rest.response.status200(res, inventories);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getTopSellingProducts(req, res, next) {
    try {
      const { dapp, query } = req;
      let inventories = await dapp.getTopSellingProducts({ ...query });
      // const productsWithImageUrl = inventories.map(product => ({
      //   ...product,
      //   imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName)
      //   )
      // }))
      inventories = inventories.map((inventory) => {
        let img = "";
        if (
          inventory.productImageLocation !== null &&
          inventory.productImageLocation !== undefined &&
          inventory?.productImageLocation?.length > 0
        ) {
          img = inventory.productImageLocation.map((item) => {
            return getSignedUrlFromS3(item, req.app.get(constants.s3ParamName));
          });
        }
        return { ...inventory, productImageLocation: img };
      });
      rest.response.status200(res, inventories);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getTopSellingProductsLoggedIn(req, res, next) {
    try {
      const { dapp, query } = req;
      let inventories = await dapp.getTopSellingProductsLoggedIn({
        ...query,
      });
      // const productsWithImageUrl = inventories.map(product => ({
      //   ...product,
      //   imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName)
      //   )
      // }))
      inventories = inventories.map((inventory) => {
        let img = "";
        if (
          inventory.productImageLocation !== null &&
          inventory.productImageLocation !== undefined &&
          inventory?.productImageLocation?.length > 0
        ) {
          img = inventory.productImageLocation.map((item) => {
            return getSignedUrlFromS3(item, req.app.get(constants.s3ParamName));
          });
        }
        return { ...inventory, productImageLocation: img };
      });
      rest.response.status200(res, inventories);

      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default MarketplaceController;
