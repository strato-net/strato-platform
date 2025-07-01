import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getOAuthConfig } from "../config";
import { getUserAddressFromToken } from "../utils";

interface CustomRequest extends Request {
  user?: {
    userAddress: string;
    [key: string]: any;
  };
}

export const verifyAccessToken = () => {
  return async (req: CustomRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Missing or invalid token" });
    }

    const token = authHeader.split(" ")[1];

    try {
      const { issuer, keyCache } = getOAuthConfig();

      // Decode token header to get the key ID (kid)
      const decodedHeader = jwt.decode(token, { complete: true });
      if (!decodedHeader || typeof decodedHeader === 'string') {
        return res.status(401).json({ success: false, message: "Invalid token format" });
      }

      const kid = decodedHeader.header.kid;
      if (!kid) {
        return res.status(401).json({ success: false, message: "Missing key ID in token" });
      }

      // Get the cached public key
      const publicKey = keyCache.get(kid);
      if (!publicKey) {
        console.error(`❌ Key not found in cache: ${kid}`);
        return res.status(401).json({ success: false, message: "Token signing key not found" });
      }

      // Verify the token synchronously using cached key (no HTTP calls)
      jwt.verify(token, publicKey, { 
        algorithms: ["RS256"], 
        issuer 
      }, async (err: jwt.VerifyErrors | null, decoded: any) => {
        if (err) {
          console.error("Token verification failed:", err);
          return res.status(401).json({ success: false, message: "Invalid token" });
        }
        try {
          const userAddress = await getUserAddressFromToken(token);
          req.user = { userAddress };
          next();
        } catch (error) {
          console.error("User extraction failed:", error);
          return res.status(401).json({ success: false, message: "Failed to extract user info" });
        }
      });
    } catch (error) {
      console.error("JWT verification failed:", error);
      return res.status(401).json({ success: false, message: "Invalid token" });
    }
  };
};
