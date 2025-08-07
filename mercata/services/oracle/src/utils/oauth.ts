import axios from 'axios';

class OAuthClient {
    private discoveryUrl: string;
    private clientId: string;
    private clientSecret: string;
    private username: string;
    private password: string;

    private accessToken: string | null = null;
    private tokenExpiry: number | null = null;
    private tokenEndpoint: string | null = null;

    constructor() {
        this.discoveryUrl = process.env.OAUTH_DISCOVERY_URL!;
        this.clientId = process.env.OAUTH_CLIENT_ID!;
        this.clientSecret = process.env.OAUTH_CLIENT_SECRET!;
        this.username = process.env.USERNAME!;
        this.password = process.env.PASSWORD!;
    }

    async getTokenEndpoint(): Promise<string> {
        if (this.tokenEndpoint) {
            return this.tokenEndpoint;
        }

        try {
            console.log('[OAuth] Discovering token endpoint...');
            const response = await axios.get(this.discoveryUrl, { timeout: 10000 });
            this.tokenEndpoint = response.data.token_endpoint;

            if (!this.tokenEndpoint) {
                throw new Error('Token endpoint not found in discovery document');
            }

            console.log(`[OAuth] Token endpoint discovered: ${this.tokenEndpoint}`);
            return this.tokenEndpoint;
        } catch (error: any) {
            console.error('[OAuth] Error discovering token endpoint:', error.message);
            throw new Error(`OAuth discovery failed: ${error.message}`);
        }
    }

    async getAccessToken(): Promise<string> {
        // Return cached token if still valid
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            console.log('[OAuth] Using cached access token');
            return this.accessToken;
        }

        // Request new token
        await this.refreshToken();
        return this.accessToken!;
    }

    async refreshToken(): Promise<string> {
        try {
            console.log(`[OAuth] Requesting new access token for user: ${this.username}...`);

            // Get the token endpoint from discovery
            const tokenEndpoint = await this.getTokenEndpoint();

            // Use password grant to authenticate as the specific username
            const tokenData = new URLSearchParams();
            tokenData.append('grant_type', 'password');
            tokenData.append('username', this.username);
            tokenData.append('password', this.password);
            tokenData.append('client_id', this.clientId);
            tokenData.append('client_secret', this.clientSecret);

            const response = await axios.post(tokenEndpoint, tokenData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                timeout: 10000
            });

            if (response.data.access_token) {
                this.accessToken = response.data.access_token;
                // Set expiry to 90% of actual expiry for safety margin
                const expiresIn = response.data.expires_in || 3600; // Default 1 hour
                this.tokenExpiry = Date.now() + (expiresIn * 1000 * 0.9);

                console.log(`[OAuth] Access token obtained successfully for ${this.username} (expires in ${expiresIn}s)`);
                return this.accessToken!;
            } else {
                throw new Error('No access token in response');
            }
        } catch (error: any) {
            console.error('[OAuth] Error getting access token:', error.response?.data || error.message);

            // Try fallback to client credentials if password grant fails
            console.log('[OAuth] Trying fallback to client credentials...');
            try {
                const tokenData = new URLSearchParams();
                tokenData.append('grant_type', 'client_credentials');

                const fallbackResponse = await axios.post(await this.getTokenEndpoint(), tokenData, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json',
                        'Authorization': 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
                    },
                    timeout: 10000
                });

                if (fallbackResponse.data.access_token) {
                    this.accessToken = fallbackResponse.data.access_token;
                    const expiresIn = fallbackResponse.data.expires_in || 3600;
                    this.tokenExpiry = Date.now() + (expiresIn * 1000 * 0.9);

                    console.log(`[OAuth] Fallback client credentials successful (expires in ${expiresIn}s)`);
                    return this.accessToken!;
                }
            } catch (fallbackError: any) {
                console.error('[OAuth] Fallback also failed:', fallbackError.message);
            }

            throw new Error(`OAuth authentication failed: ${error.message}`);
        }
    }

    async validateToken(): Promise<boolean> {
        try {
            const token = await this.getAccessToken();
            return !!token;
        } catch (error: any) {
            console.error('[OAuth] Token validation failed:', error.message);
            return false;
        }
    }

    // Force refresh token (useful for testing)
    async forceRefresh(): Promise<string> {
        this.accessToken = null;
        this.tokenExpiry = null;
        return await this.getAccessToken();
    }
}

// Export singleton instance
export const oauthClient = new OAuthClient();