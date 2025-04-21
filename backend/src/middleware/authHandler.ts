import { Request, Response, NextFunction, RequestHandler } from 'express';
import RestStatus from 'http-status-codes';
import { jwtDecode } from 'jwt-decode';
import { serverHost } from '../config/config';
import { getServiceToken, createOrGetKey } from '../utils/authHelper';
import axios from 'axios';

declare module 'express-serve-static-core' {
  interface Request {
    address?: string;
    accessToken?: { token: string };
  }
}

// ————————————————————————————————————————————————————————————————
// Helper functions, with explicit return types
// ————————————————————————————————————————————————————————————————

async function getTokenFromHeader(req: Request): Promise<string | null> {
  const headerToken = req.headers['x-user-access-token'] as string | undefined;
  if (headerToken) return headerToken;

  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const [bearer, token] = auth.split(' ');
    if (bearer === 'Bearer' && token) return token;
  }
  return null;
}

// ————————————————————————————————————————————————————————————————
// AuthHandler class
// ————————————————————————————————————————————————————————————————

class AuthHandler {
  /**
   * Middleware that enforces OAuth on incoming requests.
   * @param allowAnonAccess if true, will fall back to a service-token.
   */
  static authorizeRequest(allowAnonAccess = false): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        let token = await getTokenFromHeader(req);

        if (!token && allowAnonAccess) {
          token = await getServiceToken();
        }

        if (token) {
          let decoded: any;
          try {
            decoded = jwtDecode(token);
          } catch (err) {
            res
              .status(RestStatus.BAD_REQUEST)
              .json({ error: 'Access token is not a valid JWT' });
            return next(err);
          }

          // fetch or create user key in Strato
          let address: string;
          try {
            address = await createOrGetKey(
              { username: decoded.preferred_username, token },
            );
          } catch (err) {
            console.error('STRATO API is unreachable or unhealthy. Error:', err);
            res
              .status(RestStatus.INTERNAL_SERVER_ERROR)
              .json({
                error: 'Internal Server Error 101'
              });
            return next(err);
          }

          req.address = address;
          req.accessToken = { token };
          return next();
        }
      } catch (err) {
        return next(err);
      }

      // check server health before deciding how to respond
      let healthy = true;
      try {
        const response = await axios.get<{ health: boolean }>(
          `${serverHost}/health`
        );
        healthy = response.data.health;
      } catch (error) {
        console.log('Health check failed:', error);
      }

      if (healthy) {
        res
          .status(RestStatus.UNAUTHORIZED)
          .json({
            error: 'Authorization required',
            loginUrl: '/login/'
          });
        return next(new Error('Authorization required'));

      } else {
        res
          .status(RestStatus.INTERNAL_SERVER_ERROR)
          .json({
            error: 'Internal Server Error 101'
          });
        return next(new Error('Internal Server Error 101'));
      }
    };
  }
}

export default AuthHandler;