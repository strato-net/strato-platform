import { Request } from "express";

export interface ExtendedRequest extends Request {
  address?: string;
  accessToken?: { token: string };
}

export interface TokenCache {
  serviceToken?: string;
  expiresAt?: number;
}