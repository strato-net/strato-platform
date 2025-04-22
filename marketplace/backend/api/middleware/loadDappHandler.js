import dappJs from '/dapp/dapp/dapp';
import constants from '../../helpers/constants';
import config from '/load.config';

const options = { config };

/**
 * Express middleware to load and initialize the DApp context for the authenticated user.
 *
 * This middleware assumes that the `authHandler` middleware has already run and attached
 * user information (`username`, `accessToken`, `address`) and the application instance (`app`)
 * to the `req` object.
 *
 * It constructs a `user` object containing credentials, node configuration, and the user's address.
 * It retrieves deployment information from the application settings.
 * Finally, it uses `dappJs.bind` to create a user-specific DApp instance and attaches it to `req.dapp`.
 * The DApp instance is bound with the user's context, allowing subsequent handlers to interact
 * with the blockchain contracts as that user.
 * If the username is 'serviceUser', it passes true to the bind function, possibly indicating
 * a different mode of operation for service accounts.
 *
 * @param {import('express').Request & { username?: string, accessToken?: object, address?: string, app?: any }} req - The Express request object, augmented by previous middleware.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The next middleware function in the stack.
 * @returns {Promise<void>} Calls `next()` when done or `next(error)` if an error occurs during DApp binding.
 */
const loadDapp = async (req, res, next) => {
  const { app, username, accessToken, address } = req;

  const userCredentials = {
    username,
    ...accessToken,
  };
  console.log(`Requester username/uuid: ${username}`);
  const user = {
    ...userCredentials,
    node: config.nodes[0],
    address,
  };

  const deploy = app.get(constants.deployParamName);

  req.user = user;
  req.dapp = await dappJs.bind(
    user,
    deploy.dapp.contract,
    {
      chainIds: [deploy.dapp.contract.appChainId],
      ...options,
    },
    username === 'serviceUser' ? true : false
  );

  return next();
};

export default loadDapp;
