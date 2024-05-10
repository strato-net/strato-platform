import { rest, oauthUtil } from 'blockapps-rest';
import jwtDecode from 'jwt-decode';
import config from '../load.config.js';
import { TOKEN_LIFETIME_RESERVE_SECONDS } from './constants.js';

const options = { config };

const oauth = await oauthUtil.init(config.nodes[0].oauth);

const getEmailIdFromToken = function (accessToken) {
  return jwtDecode(accessToken).email;
}

async function createStratoUser(accessToken) {
  try {
    const user = await rest.createUser(accessToken, options);
    return { status: 200, message: 'success', user };
  } catch (e) {
    return {
      // eslint-disable-next-line no-nested-ternary
      status: e.response
        ? e.response.status
        : e.code
          ? e.code
          : 'NO_CONNECTION',
      message: 'error while creating user',
    };
  }
}

const getServiceToken = async (token = null, expiration = null) => {
  if (
    !token
    || !expiration
    || expiration
      <= Math.floor(Date.now() / 1000)
        + TOKEN_LIFETIME_RESERVE_SECONDS
  ) {
    const tokenObj = await oauth.getAccessTokenByClientSecret();
    const new_token = tokenObj.token[
      config.nodes[0].oauth.tokenField
        ? config.nodes[0].oauth.tokenField
        : 'access_token'
    ];
    const expiresAt = Math.floor(
      tokenObj.token.expires_at / 1000,
    );
    return { token: new_token, expiration: expiresAt };
  }

  return { token: token, expiration: expiration };
}

export default {
  getEmailIdFromToken,
  createStratoUser,
  getServiceToken,
}
