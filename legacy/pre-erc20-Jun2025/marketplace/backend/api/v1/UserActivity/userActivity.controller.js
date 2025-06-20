import { rest } from 'blockapps-rest';

class UserActivityController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;
      const userActivity = await dapp.getAllUserActivity({ ...query });
      rest.response.status200(res, userActivity);

      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default UserActivityController;
