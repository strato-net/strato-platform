import { rest } from 'blockapps-rest';
import RestStatus from 'http-status-codes';
import dappJs from '/dapp/dapp/dapp';
import constants from '../../helpers/constants';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import jwtDecode from 'jwt-decode';

const options = { config };

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
