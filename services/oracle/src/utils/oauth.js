const axios = require('axios');

class OAuthClient {
    constructor() {
        this.oauthUrl = process.env.OAUTH_URL;
        this.clientId = process.env.CLIENT_ID;
        this.clientSecret = process.env.CLIENT_SECRET;
        this.username = process.env.USERNAME;
        this.password = process.env.PASSWORD;
        
        this.accessToken = null;
        this.tokenExpiry = null;
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

            const tokenData = new URLSearchParams();
            tokenData.append('grant_type', 'client_credentials');
            tokenData.append('client_id', this.clientId);
            tokenData.append('client_secret', this.clientSecret);

            // If username/password are provided, use password grant
            if (this.username && this.password) {
                tokenData.set('grant_type', 'password');
                tokenData.append('username', this.username);
                tokenData.append('password', this.password);
            }

            const response = await axios.post(this.oauthUrl, tokenData, {
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