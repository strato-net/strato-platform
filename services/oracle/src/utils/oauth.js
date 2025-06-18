const axios = require('axios');

class OAuthClient {
    constructor() {
        this.discoveryUrl = process.env.OAUTH_DISCOVERY_URL;
        this.clientId = process.env.CLIENT_ID;
        this.clientSecret = process.env.CLIENT_SECRET;
        this.username = process.env.USERNAME;
        this.password = process.env.PASSWORD;
        
        this.accessToken = null;
        this.tokenExpiry = null;
        this.tokenEndpoint = null;
    }

    async getTokenEndpoint() {
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
        } catch (error) {
            console.error('[OAuth] Error discovering token endpoint:', error.message);
            throw new Error(`OAuth discovery failed: ${error.message}`);
        }
    }

    async getAccessToken() {
        // Return cached token if still valid
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            console.log('[OAuth] Using cached access token');
            return this.accessToken;
        }

        // Request new token
        await this.refreshToken();
        return this.accessToken;
    }

    async refreshToken() {
        try {
            console.log('[OAuth] Requesting new access token...');

            // Get the token endpoint from discovery
            const tokenEndpoint = await this.getTokenEndpoint();

            // Use Basic Auth for client credentials (like your backend)
            // Plus username/password in body for user authentication
            const tokenData = new URLSearchParams();
            
            if (this.username && this.password) {
                // Use password grant with user credentials
                tokenData.append('grant_type', 'password');
                tokenData.append('username', this.username);
                tokenData.append('password', this.password);
            } else {
                // Fallback to client credentials
                tokenData.append('grant_type', 'client_credentials');
            }

            const response = await axios.post(tokenEndpoint, tokenData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'Authorization': 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
                },
                timeout: 10000
            });

            if (response.data.access_token) {
                this.accessToken = response.data.access_token;
                // Set expiry to 90% of actual expiry for safety margin
                const expiresIn = response.data.expires_in || 3600; // Default 1 hour
                this.tokenExpiry = Date.now() + (expiresIn * 1000 * 0.9);
                
                console.log(`[OAuth] Access token obtained successfully (expires in ${expiresIn}s)`);
                return this.accessToken;
            } else {
                throw new Error('No access token in response');
            }
        } catch (error) {
            console.error('[OAuth] Error getting access token:', error.response?.data || error.message);
            throw new Error(`OAuth authentication failed: ${error.message}`);
        }
    }

    async validateToken() {
        try {
            const token = await this.getAccessToken();
            return !!token;
        } catch (error) {
            console.error('[OAuth] Token validation failed:', error.message);
            return false;
        }
    }

    // Force refresh token (useful for testing)
    async forceRefresh() {
        this.accessToken = null;
        this.tokenExpiry = null;
        return await this.getAccessToken();
    }
}

// Export singleton instance
const oauthClient = new OAuthClient();
module.exports = { oauthClient };