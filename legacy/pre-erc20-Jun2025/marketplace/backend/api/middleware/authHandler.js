import RestStatus from 'http-status-codes';
import oauthHelper from '/helpers/oauthHelper';
import { oauthUtil, rest } from 'blockapps-rest';
import jwtDecode from 'jwt-decode';
import config from '/load.config';
import axios from 'axios';

const getTokenFromCookie = async (req, res) => {
  const tokenName = req.app.oauth.getCookieNameAccessToken();
  if (req.cookies[tokenName]) {
    try {
      await req.app.oauth.validateAndGetNewToken(req, res);
      return req.cookies[tokenName]; // the cookie may have the updated value here after validateAndGetNewToken()
    } catch (err) {
      console.log(
        'Access token is either invalid or expired and could not been refreshed'
      );
    }
  }
  return null;
};

const getTokenFromHeader = async (req) => {
  if (req.headers['x-user-access-token'])
    return req.headers['x-user-access-token'];

  if (req.headers['authorization']) {
    const [bearer, token] = req.headers['authorization'].split(' ');
    if (bearer !== 'Bearer') return null;
    return token;
  }
  return null;
};

const getLoginUrl = (req) =>
  config.dockerized ? '/login/' : req.app.oauth.getSigninURL();

class AuthHandler {
  static authorizeRequest(allowAnonAccess = false) {
    return async function (req, res, next) {
      try {
        let token = await getTokenFromCookie(req, res);
        let address;
        if (!token) {
          token = await getTokenFromHeader(req);
        }
        let isServiceUser = false;
        if (!token && allowAnonAccess === true) {
          token = await oauthHelper.getServiceToken(req);
          isServiceUser = true;
        }

        if (token) {
          console.log('Got token');
          let decodedToken;
          try {
            decodedToken = jwtDecode(token);
          } catch (err) {
            rest.response.status(
              RestStatus.BAD_REQUEST,
              res,
              'Access token is not a valid JWT'
            );
            return next(err);
          }
          try {
            address = await rest.createOrGetKey(
              { username: decodedToken.preferred_username, token },
              { config }
            );
          } catch (e) {
            console.error('STRATO API is unreachable or unhealthy. Error: ', e);
            return rest.response.status(
              RestStatus.INTERNAL_SERVER_ERROR,
              res,
              'Internal Server Error 101'
            );
          }
          req.address = address;
          req.accessToken = { token };
          req.decodedToken = decodedToken;
          req.username =
            isServiceUser === true
              ? 'serviceUser'
              : decodedToken.preferred_username;
          console.log('Authorization success, moving on...');
          return next();
        }
      } catch (err) {
        return next(err);
      }

      res.clearCookie(req.app.oauth.getCookieNameAccessToken());
      res.clearCookie(req.app.oauth.getCookieNameAccessTokenExpiry());
      res.clearCookie(req.app.oauth.getCookieNameRefreshToken());

      let health = true;
      try {
        const response = await axios.get(`${config.serverHost}/health`);
        health = response.data.health;
      } catch (error) {
        console.log('error', error);
      }

      // Here, we're checking the server's health. If it's determined to be false,
      // we'll throw an Internal Server Error along with a message to indicate the issue.
      if (health) {
        rest.response.status(RestStatus.UNAUTHORIZED, res, {
          loginUrl: getLoginUrl(req),
        });
        return next(new Error('Authorization required'));
      } else {
        return rest.response.status(
          RestStatus.INTERNAL_SERVER_ERROR,
          res,
          'Internal Server Error 101'
        );
      }
    };
  }

  static async initOauth() {
    let oauth;
    try {
      oauth = await oauthUtil.init(config.nodes[0].oauth);
    } catch (err) {
      console.log('Error initializing oauth handlers');
      process.exit(1);
    }
    return oauth;
  }

  static getDeployersTokenForWebhook() {
    return async function (req, res, next) {
      try {
        let globalAdminToken = await oauthHelper.getUserToken(
          `${process.env.GLOBAL_ADMIN_NAME}`,
          `${process.env.GLOBAL_ADMIN_PASSWORD}`
        );
        let address;

        if (globalAdminToken) {
          console.log('Got token');
          let decodedToken;
          try {
            decodedToken = jwtDecode(globalAdminToken);
          } catch (err) {
            rest.response.status(
              RestStatus.BAD_REQUEST,
              res,
              'Access token is not a valid JWT'
            );
            return next();
          }
          try {
            address = await rest.getKey(
              {
                username: decodedToken.preferred_username,
                token: globalAdminToken,
              },
              { config }
            );
          } catch (e) {
            // user isn't created in STRATO
            if (e.response && e.response.status === RestStatus.BAD_REQUEST) {
              console.log('User not created in STRATO!');
              return next(e);
            }
          }
          req.address = address;
          req.accessToken = { token: globalAdminToken };
          req.decodedToken = decodedToken;
          req.username = decodedToken.preferred_username;
          console.log('Authorization success, moving on...');
          return next();
        }
      } catch (err) {
        rest.response.status(
          RestStatus.INTERNAL_SERVER_ERROR,
          res,
          'Internal Server Error'
        );
        return next();
      }

      rest.response.status(RestStatus.UNAUTHORIZED, res, {
        loginUrl: getLoginUrl(req),
      });
      return next();
    };
  }
}

export default AuthHandler;
