import { logInfo, logError } from './logger';
import { apiGet, apiPost } from './apiClient';


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

    // Promise deduplication: concurrent callers share one in-flight request
    private refreshPromise: Promise<string> | null = null;
    private discoveryPromise: Promise<string> | null = null;
    private addressPromise: Promise<string> | null = null;

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

        // Deduplicate concurrent discovery requests
        if (this.discoveryPromise) {
            return this.discoveryPromise;
        }

        this.discoveryPromise = (async () => {
            try {
                logInfo('OAuth', 'Discovering token endpoint...');
                const response = await apiGet(
                    this.discoveryUrl,
                    { timeout: 10000 },
                    { logPrefix: 'OAuth', apiUrl: this.discoveryUrl, method: 'GET' }
                );
                this.tokenEndpoint = response.data.token_endpoint;

                if (!this.tokenEndpoint) {
                    throw new Error('Token endpoint not found in discovery document');
                }

                logInfo('OAuth', `Token endpoint discovered: ${this.tokenEndpoint}`);
                return this.tokenEndpoint;
            } catch (error: any) {
                throw new Error(`OAuth discovery failed: ${error.message}`);
            } finally {
                this.discoveryPromise = null;
            }
        })();

        return this.discoveryPromise;
    }

    async getAccessToken(): Promise<string> {
        // Return cached token if still valid
        if (this.accessToken && this.tokenExpiry && Date.now() < (this.tokenExpiry - (TOKEN_LIFETIME_THRESHOLD_SECONDS * 1000))) {
            return this.accessToken;
        }

        // Deduplicate concurrent refresh requests
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        this.refreshPromise = this.refreshToken().finally(() => {
            this.refreshPromise = null;
        });

        return this.refreshPromise;
    }

    async refreshToken(): Promise<string> {
        let tokenEndpoint: string | undefined;
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

            const response = await apiPost(
                tokenEndpoint,
                tokenData,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                },
                { logPrefix: 'OAuth', apiUrl: tokenEndpoint, method: 'POST' }
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

        // Deduplicate concurrent address requests
        if (this.addressPromise) {
            return this.addressPromise;
        }

        this.addressPromise = (async () => {
            const keyEndpoint = `${process.env.STRATO_NODE_URL}/strato/v2.3/key`;
            try {
                const accessToken = await this.getAccessToken();
                const response = await apiGet(
                    keyEndpoint,
                    {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000
                    },
                    { logPrefix: 'OAuth', apiUrl: keyEndpoint, method: 'GET' }
                );

                this.userAddress = response.data.address;
                return this.userAddress!;
            } catch (error: any) {
                const errorMessage = error.response?.data?.message || error.message;
                throw new Error(`Failed to get user address: ${errorMessage}`);
            } finally {
                this.addressPromise = null;
            }
        })();

        return this.addressPromise;
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
