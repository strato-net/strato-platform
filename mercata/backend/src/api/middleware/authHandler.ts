import { Request, RequestHandler } from "express";
import RestStatus from "http-status-codes";
import { JWTPayload } from "jose";
import { verifyAccessTokenSignature } from "../../utils/authHelper";
import { getServiceToken, createOrGetKey } from "../../utils/authHelper";
import { requestContext } from "../../utils/requestContext";
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

type AuthOptions = {
  allowAnonAccess?: boolean;
  allowWalletAuth?: boolean;
};

// ————————————————————————————————————————————————————————————————
// AuthHandler class
// ————————————————————————————————————————————————————————————————

class AuthHandler {
  /**
   * Middleware that enforces OAuth on incoming requests.
   * @param allowAnonAccess true = always allow anonymous, false = always require auth,
   *   undefined (default) = allow anonymous for safe methods (GET/HEAD/OPTIONS), require auth for mutating methods.
   * @param allowWalletAuth true = allow X-Wallet-Address to authenticate unsafe methods on routes that return unsigned txs.
   */
  static authorizeRequest(options?: boolean | AuthOptions): RequestHandler {
    return async (req, res, next) => {
      try {
        const allowAnonAccess = typeof options === "boolean" ? options : options?.allowAnonAccess;
        const allowWalletAuth = typeof options === "object" ? options.allowWalletAuth === true : false;
        let token = getTokenFromHeader(req);
        const walletAddress = req.headers["x-wallet-address"] as string | undefined;

        const isSafeMethod = ["GET", "HEAD", "OPTIONS"].includes(req.method);
        const effectiveAllowAnon = allowAnonAccess ?? isSafeMethod;
        const walletAuthenticated = !!walletAddress && (isSafeMethod || allowWalletAuth);
        const isServiceUser = !token && (effectiveAllowAnon || walletAuthenticated);

        if (isServiceUser) {
          token = await getServiceToken();
        }

        if (token) {
          let payload: CustomJwtPayload;
          try {
            payload = await verifyAccessTokenSignature(token) as CustomJwtPayload;
          } catch (err) {
            res.status(RestStatus.UNAUTHORIZED).json({ error: "Invalid or expired access token" });
            return next(err);
          }

          if (!isServiceUser) {
            let userName: string = payload["preferred_username"];
            req.address = walletAddress
              ? walletAddress.replace(/^0x/i, "").toLowerCase()
              : await createOrGetKey(token);
            req.userName = userName;
          } else if (walletAddress) {
            req.address = walletAddress.replace(/^0x/i, "").toLowerCase();
          }
          req.accessToken = token;

          if (walletAddress) {
            return requestContext.run(
              { externalSigning: true, userAddress: walletAddress.replace(/^0x/i, "").toLowerCase() },
              next
            );
          }
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
