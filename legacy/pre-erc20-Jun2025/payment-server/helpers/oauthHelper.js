import { rest, oauthUtil } from "blockapps-rest";
import jwtDecode from "jwt-decode";
import config from "../load.config.js";

const CACHED_DATA = {
  serviceToken: null,
  serviceTokenExpiresAt: null,
};

const options = { config };

const oauth = await oauthUtil.init(config.nodes[0].oauth);

const getEmailIdFromToken = function (accessToken) {
  return jwtDecode(accessToken).email;
};

async function createStratoUser(accessToken) {
  try {
    const user = await rest.createUser(accessToken, options);
    return { status: 200, message: "success", user };
  } catch (e) {
    return {
      // eslint-disable-next-line no-nested-ternary
      status: e.response
        ? e.response.status
        : e.code
        ? e.code
        : "NO_CONNECTION",
      message: "error while creating user",
    };
  }
}

const getUserToken = async (username, password) => {
  // Fetch a new token using Resource Owner Password Credentials
  const tokenObj = await oauth.getAccessTokenByResourceOwnerCredential(
    username,
    password
  );
  return {
    token:
      tokenObj.token[
        config.nodes[0].oauth.tokenField
          ? config.nodes[0].oauth.tokenField
          : "access_token"
      ],
  };
};

const getServiceToken = async () => {
  let token = CACHED_DATA.serviceToken;
  const expiresAt = CACHED_DATA.serviceTokenExpiresAt;
  if (
    !token ||
    !expiresAt ||
    expiresAt <= Math.floor(Date.now() / 1000) + 30 // 30 seconds buffer
  ) {
    console.log("Getting a fresh service token...");
    const tokenObj = await oauth.getAccessTokenByClientSecret();
    token =
      tokenObj.token[
        config.nodes[0].oauth.tokenField
          ? config.nodes[0].oauth.tokenField
          : "access_token"
      ];
    CACHED_DATA.serviceToken = token;
    CACHED_DATA.serviceTokenExpiresAt = Math.floor(
      tokenObj.token.expires_at / 1000
    );
  }
  return { token };
};

export default {
  getEmailIdFromToken,
  createStratoUser,
  getServiceToken,
  getUserToken,
};
