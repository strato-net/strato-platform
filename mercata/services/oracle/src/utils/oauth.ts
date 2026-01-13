import axios from 'axios';
import { logInfo, logError } from './logger';
import { withRetry } from './apiClient';
import { DEFAULT_RETRY_CONFIG } from './constants';


const TOKEN_LIFETIME_THRESHOLD_SECONDS = 10;

class OAuthClient {
    private discoveryUrl: string;
    private clientId: string;
    private clientSecret: string;
    private username: string;
    private password: string;
    
    private accessToken: string | null = null;
    private tokenExpiry: number | null = null;
    private tokenEndpoint: string | null = null;
    private userAddress: string | null = null;

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
            logInfo('OAuth', 'Discovering token endpoint...');
            const response = await axios.get(this.discoveryUrl, { timeout: 10000 });
            this.tokenEndpoint = response.data.token_endpoint;

            if (!this.tokenEndpoint) {
                throw new Error('Token endpoint not found in discovery document');
            }

            logInfo('OAuth', `Token endpoint discovered: ${this.tokenEndpoint}`);
            return this.tokenEndpoint;
        } catch (error: any) {
            logError('OAuth', new Error(`Failed to call GET ${this.discoveryUrl}: ${error.message}`));
            throw new Error(`OAuth discovery failed: ${error.message}`);
        }
    }

    async getAccessToken(): Promise<string> {
        // Return cached token if still valid
        if (this.accessToken && this.tokenExpiry && Date.now() < (this.tokenExpiry - (TOKEN_LIFETIME_THRESHOLD_SECONDS * 1000))) {
            return this.accessToken;
        }

        // Request new token
        await this.refreshToken();
        return this.accessToken!;
    }

    async refreshToken(): Promise<string> {
        let tokenEndpoint: string = '';
        try {
            // Get the token endpoint from discovery
            tokenEndpoint = await this.getTokenEndpoint();

            // Use password grant to authenticate as the specific username
            const tokenData = new URLSearchParams();
            tokenData.append('grant_type', 'password');
            tokenData.append('username', this.username);
            tokenData.append('password', this.password);
            tokenData.append('client_id', this.clientId);
            tokenData.append('client_secret', this.clientSecret);

            const response = await withRetry(
                () => axios.post(tokenEndpoint, tokenData, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                }),
                { ...DEFAULT_RETRY_CONFIG, logPrefix: 'OAuth', apiUrl: tokenEndpoint, method: 'POST' }
            );

            if (response.data.access_token) {
                this.accessToken = response.data.access_token;
                const expiresIn = response.data.expires_in || 3600; // Default 1 hour
                this.tokenExpiry = Date.now() + (expiresIn * 1000);

                return this.accessToken!;
            } else {
                throw new Error('No access token in response');
            }
        } catch (error: any) {
            const errorMessage = error.response?.data?.error_description || error.response?.data?.error || error.message;
            const endpoint = tokenEndpoint || this.discoveryUrl;
            logError('OAuth', new Error(`Failed to call POST ${endpoint}: ${errorMessage}`));
            throw new Error(`OAuth authentication failed: ${errorMessage}`);
        }
    }

    async validateToken(): Promise<boolean> {
        try {
            const token = await this.getAccessToken();
            if (token) {
                // Cache user address during validation
                await this.getUserAddress();
            }
            return !!token;
        } catch (error) {
            // Re-throw the error so validateConfig can catch it
            throw error;
        }
    }

    async getUserAddress(): Promise<string> {
        if (this.userAddress) {
            return this.userAddress;
        }

        const keyEndpoint = `${process.env.STRATO_NODE_URL}/strato/v2.3/key`;
        try {
            const accessToken = await this.getAccessToken();
            const response = await axios.get(
                keyEndpoint,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            this.userAddress = response.data.address;
            return this.userAddress!;
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || error.message;
            logError('OAuth', new Error(`Failed to call GET ${keyEndpoint}: ${errorMessage}`));
            throw new Error(`Failed to get user address: ${errorMessage}`);
        }
    }


}

// Export singleton instance with lazy initialization
let _oauthClient: OAuthClient | null = null;

export const oauthClient = (): OAuthClient => {
    if (!_oauthClient) {
        _oauthClient = new OAuthClient();
    }
    return _oauthClient;
}; 
