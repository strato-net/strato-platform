import { Request, RequestHandler } from "express";
import RestStatus from "http-status-codes";
import { JWTPayload } from "jose";
import { verifyAccessTokenSignature } from "../../utils/authHelper";
import { getServiceToken, createOrGetKey } from "../../utils/authHelper";
// ————————————————————————————————————————————————————————————————
// Helper functions, with explicit return types
// ————————————————————————————————————————————————————————————————

/**
 * Get the token from the header (x-user-access-token if it's present, or authorization header if not)
 * @param req - The request object
 * @returns The token from the header
 */
function getTokenFromHeader(req: Request): string | null {
  const headerToken = req.headers["x-user-access-token"] as string | undefined;
  // When running in dockerized prod mode, the jwt from x-user-access-token header can be trusted (validated and set at the edge in nginx)

  if (headerToken) return headerToken;

  // When running in dockerized prod mode, the Authorization header is always empty (cleared explicitly by nginx) - Authotization header can only be used for local development (for direct api calls to npm server)
  const auth = req.headers["authorization"];
  // When running in dockerized prod mode, the authorization header is always empty (cleared explicitly by nginx) - this is only used for local development (for direct api calls to npm server)

  if (typeof auth === "string") {
    const [bearer, token] = auth.split(" ");
    if (bearer === "Bearer" && token) return token;
  }
  return null;
}

interface CustomJwtPayload extends JWTPayload {
  preferred_username: string;
}

// ————————————————————————————————————————————————————————————————
// AuthHandler class
// ————————————————————————————————————————————————————————————————

class AuthHandler {
  /**
   * Middleware that allows requests with Bearer token equal to OPERATOR_ACCESS_TOKEN (for internal services).
   */
  static authorizeOperatorRequest(): RequestHandler {
    return (req, res, next) => {
      const token = getTokenFromHeader(req);
      const operatorToken = process.env.OPERATOR_ACCESS_TOKEN;
      if (operatorToken && token === operatorToken) {
        req.accessToken = token;
        return next();
      }
      res.set("WWW-Authenticate", "Bearer");
      res.status(401).json({ error: "Unauthorized", message: "Operator token required" });
    };
  }

  /**
   * Middleware that enforces OAuth on incoming requests.
   * @param allowAnonAccess if true, will fall back to a service-token.
   */
  static authorizeRequest(allowAnonAccess = false): RequestHandler {
    return async (req, res, next) => {
      try {
        let token = getTokenFromHeader(req);
        // if it is service user do not set userAddress and userName
        const isServiceUser = !token && allowAnonAccess

        if (isServiceUser) {
          // The token obtained from the trusted oauth2 server can be trusted here, but is still always verified further in a resource server.

          token = await getServiceToken();
        }

        if (token) {
          // Verify JWT signature and extract payload using cached JWKS (loaded at startup)
          let payload: CustomJwtPayload;
          try {
            payload = await verifyAccessTokenSignature(token) as CustomJwtPayload;
          } catch (err) {
            res.status(RestStatus.UNAUTHORIZED).json({ error: "Invalid or expired access token" });
            return next(err);
          }

          if (!isServiceUser) {
            // fetch or create user key in Strato
            let address = await createOrGetKey(token);
            let userName: string = payload["preferred_username"];
            req.address = address;
            req.userName = userName;
          }
          req.accessToken = token;
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
