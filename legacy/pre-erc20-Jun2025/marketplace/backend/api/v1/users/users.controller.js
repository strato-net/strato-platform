import { rest } from 'blockapps-rest';
import config from '../../../load.config';
import { pollingHelper, searchAllWithQueryArgs } from '../../../helpers/utils';
import constants, { ISSUER_STATUS } from '../../../helpers/constants';

const options = { config, cacheNonce: true };

class UsersController {
    static async me(req, res, next) {
    try {
      const { accessToken, decodedToken, address } = req;
      const username = decodedToken.preferred_username;
      const email = decodedToken.email;
      const walletSearchOptions = {
	  userAddress: address,
          notEqualsField: 'issuerStatus',
          notEqualsValue: 'null',
          sort: '-block_timestamp',
          limit: 1,
      };
      const walletResp = await searchAllWithQueryArgs(
          constants.userContractName,
          walletSearchOptions,
          options,
          accessToken
      );

      rest.response.status200(res, {
	  preferred_username: username,
	  email: email,
	  address: address,
          issuerStatus: walletResp[0]
            ? walletResp[0].issuerStatus
            : ISSUER_STATUS.UNAUTHORIZED,
          isAdmin: walletResp[0] ? walletResp[0].isAdmin : false,
      });

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async get(req, res, next) {
    try {
      const { dapp, query } = req;
      const { address } = query;
      const user = await dapp.getCertificate({
        userAddress: address,
      });

      if (!user || Object.keys(user).length == 0) {
        rest.response.status(404, res, { address });
      } else {
        rest.response.status200(res, user);
      }
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const users = await dapp.getCertificates(query);
      return rest.response.status200(res, users);
    } catch (e) {
      return next(e);
    }
  }
}

export default UsersController;
