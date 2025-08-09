import { Request, RequestHandler } from "express";
import RestStatus from "http-status-codes";
import { jwtDecode, JwtPayload } from "jwt-decode";
import { getServiceToken, createOrGetKey } from "../../utils/authHelper";
// ————————————————————————————————————————————————————————————————
// Helper functions, with explicit return types
// ————————————————————————————————————————————————————————————————

async function getTokenFromHeader(req: Request): Promise<string | null> {
  const headerToken = req.headers["x-user-access-token"] as string | undefined;
  // When running in dockerized prod mode, the jwt from x-user-access-token header can be trusted (validated and set at the edge in nginx)
  if (headerToken) return headerToken;

  const auth = req.headers["authorization"];
  // When running in dockerized prod mode, the authorization header is always empty (cleared explicitly by nginx) - this is only used for local development (for direct api calls to npm server)
  if (typeof auth === "string") {
    const [bearer, token] = auth.split(" ");
    if (bearer === "Bearer" && token) return token;
  }
  return null;
}

interface CustomJwtPayload extends JwtPayload {
  preferred_username: string;
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
    return async (req, res, next) => {
      try {
        let token = await getTokenFromHeader(req);

        if (!token && allowAnonAccess) {
          // The token obtained from the trusted oauth2 server can be trusted here, but is still always verified further in a resource server.
          token = await getServiceToken();
        }

        if (token) {
          // NOTE: implement the JWT validation (signature verification) here if the deployment is not behind the nginx reverse proxy which does the full verification at the edge.
          let payload: CustomJwtPayload;
          try {
            payload = jwtDecode(token);
          } catch (err) {
            res
              .status(RestStatus.BAD_REQUEST)
              .json({ error: "Access token is not a valid JWT" });
            return next(err);
          }

          // fetch or create user key in Strato
          let address = await createOrGetKey(token);
          let userName:string = payload['preferred_username']

          req.address = address;
          req.accessToken = token;
          req.userName = userName;
          return next();
        } else {
          res.set('WWW-Authenticate', 'Bearer');
          res.status(401).json({
            error: 'unauthorized',
            message: 'Authentication required. Please log in at /login',
            redirect: '/login'
          });
        }
      } catch (err) {
        return next(err);
      }
    };
  }
}

export default AuthHandler;
