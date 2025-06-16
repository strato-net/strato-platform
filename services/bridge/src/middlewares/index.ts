import { Request, Response, NextFunction } from "express";
import { getUserAddressFromToken } from "../utils"; // adjust path as needed
import axios from 'axios';

// Extend Request type
interface CustomRequest extends Request {
  user?: {
    userAddress: string;
    [key: string]: any;
  };
}

// Load env variables
const { CLIENT_ID, CLIENT_SECRET, OPENID_DISCOVERY_URL } = process.env;

if (!CLIENT_ID || !CLIENT_SECRET || !OPENID_DISCOVERY_URL) {
  throw new Error(
    "Missing required environment variables: CLIENT_ID, CLIENT_SECRET, or OPENID_DISCOVERY_URL"
  );
}

async function isActiveToken(token: string) {
  try {
    const server = new URL(OPENID_DISCOVERY_URL!);
    console.log('🔍 Discovery URL:', server.toString());
    
    // First, get the OpenID Connect configuration
    const configResponse = await axios.get(server.toString());
    const config = configResponse.data;
    console.log('📋 OpenID Configuration:', JSON.stringify(config, null, 2));
    
    if (!config.introspection_endpoint) {
      throw new Error('Introspection endpoint not found in OpenID configuration');
    }
    console.log('🔑 Introspection endpoint:', config.introspection_endpoint);

    // Make token introspection request
    const response = await axios.post(config.introspection_endpoint, 
      new URLSearchParams({
        token,
        token_type_hint: 'access_token'
      }), {
        auth: {
          username: CLIENT_ID!,
          password: CLIENT_SECRET!
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    console.log("✅ Access token verified", response.data);
    return response.data.active;
  } catch (error) {
    console.error("Failed to verify token:", error);
    if (axios.isAxiosError(error)) {
      console.error('Request URL:', error.config?.url);
      console.error('Response status:', error.response?.status);
      console.error('Response data:', error.response?.data);
    }
    throw error;
  }
}

export async function verifyAccessToken(
  req: CustomRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized: No token provided" });
  }

  try {
    const isActive = await isActiveToken(token);

    if (!isActive) {
      return res
        .status(401)
        .json({
          success: false,
          message: "Unauthorized: Token is inactive or invalid",
        });
    }

    // Optionally derive user address from token
    const userAddress = await getUserAddressFromToken(token);

    console.log("✅ Access token verified");
    console.log("🔑 User address:", userAddress);

    // Attach to request
    req.user = {
      userAddress,
    };

    next();
  } catch (err) {
    console.error("❌ Token verification failed:", err);
    return res
      .status(401)
      .json({ success: false, message: "Token verification failed" });
  }
}
