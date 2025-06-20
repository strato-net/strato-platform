import { Request, Response, NextFunction } from "express";
import { getUserAddressFromToken } from "../utils"; // adjust path as needed
import axios from 'axios';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { config } from "../config";

// Extend Request type
interface CustomRequest extends Request {
  user?: {
    userAddress: string;
    [key: string]: any;
  };
}

let jwksUri: string | undefined;
let issuer: string | undefined;

export const initOpenIdDiscoveryConfig = async () => {
  const response = await fetch(process.env.OPENID_DISCOVERY_URL as string);
  const data = await response.json() as { jwks_uri: string; issuer: string };
  jwksUri = data.jwks_uri;
  issuer = data.issuer;
};

// use config from index.ts
const { openIdDiscoveryUrl } = config.auth;

// Cache for OpenID configuration
let introspectionEndpoint: string | null = null;
let isInitialized = false;

// Initialize OpenID configuration
export async function initializeOAuth() {
  if (isInitialized) {
    console.log('OAuth already initialized');
    return;
  }

  try {
    // Initialize OpenID discovery config first
    await initOpenIdDiscoveryConfig();
    
    const server = new URL(openIdDiscoveryUrl!);
    console.log('🔍 Fetching OpenID configuration from:', server.toString());
    
    const configResponse = await axios.get(server.toString());
    const config = configResponse.data;
    
    if (!config.introspection_endpoint) {
      throw new Error('Introspection endpoint not found in OpenID configuration');
    }
    
    introspectionEndpoint = config.introspection_endpoint;
    isInitialized = true;
  } catch (error) {
    console.error("Failed to initialize OpenID configuration:", error);
    throw error;
  }
}

export async function verifyAccessToken(req: CustomRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Missing or invalid token' });
  }

  const accessToken = authHeader.split(' ')[1];

  try {
    // Ensure OpenID configuration is initialized
    if (!isInitialized) {
      await initializeOAuth();
    }

    // Debug: Log the JWKS URI
    console.log('Using JWKS URI:', jwksUri);

    if (!jwksUri) {
      throw new Error('JWKS URI not initialized');
    }

    // Debug: Try to fetch JWKS data directly
    try {
      const jwksResponse = await axios.get(jwksUri);
      console.log('JWKS Response:', JSON.stringify(jwksResponse.data, null, 2));
    } catch (error) {
      console.error('Failed to fetch JWKS data:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
      }
      throw error;
    }

    // Initialize JWKS client
    const client = jwksRsa({
      jwksUri,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5
    });

    // Get the signing key
    const getKey = (header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) => {
      if (typeof header.kid !== 'string') {
        return callback(new Error('No KID in token header'));
      }
      client.getSigningKey(header.kid, (err: Error | null, key?: jwksRsa.SigningKey) => {
        if (err) {
          console.error('Error getting signing key:', err);
          return callback(err);
        }
        if (!key) {
          return callback(new Error('No signing key found'));
        }
        const signingKey = key.getPublicKey();
        callback(null, signingKey);
      });
    };

    // Debug: Log token claims
    const decodedToken = jwt.decode(accessToken, { complete: true });
    console.log('Token claims:', JSON.stringify(decodedToken, null, 2));

    // Verify the token
    jwt.verify(accessToken, getKey, {
      issuer: issuer,
      algorithms: ['RS256']
    }, async (err: jwt.VerifyErrors | null, decoded: any) => {
      if (err) {
        console.error('Token verification failed:', err);
        return res.status(401).json({ success: false, message: 'Invalid token' });
      }

      try {
        // Call your utility function to extract address from token
        const userAddress = await getUserAddressFromToken(accessToken);

        console.log('Access token verified:');
        console.log('User address extracted:', userAddress);

        // Attach user address to request for use in next handlers
        req.user = { userAddress };

        next(); // Proceed to the next middleware/handler
      } catch (err) {
        console.error('Error extracting user address:', err);
        return res.status(401).json({ success: false, message: 'Invalid token or failed to extract user address' });
      }
    });
  } catch (err) {
    console.error('Error in token verification:', err);
    return res.status(401).json({ success: false, message: 'Token verification failed' });
  }
}
