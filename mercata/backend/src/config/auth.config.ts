export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  openIdDiscoveryUrl: string;
  baUsername: string;
  baPassword: string;
}

export const authConfig: AuthConfig = {
  clientId: process.env.CLIENT_ID || '',
  clientSecret: process.env.CLIENT_SECRET || '',
  openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL || '',
  baUsername: process.env.BA_USERNAME || '',
  baPassword: process.env.BA_PASSWORD || '',
}; 