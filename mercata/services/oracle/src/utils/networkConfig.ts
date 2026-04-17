import { apiGet } from './apiClient';
import { oauthClient } from './oauth';
import { logInfo } from './logger';

let _networkId: string | null = null;

export async function initNetworkConfig(): Promise<void> {
    if (_networkId) return;
    const accessToken = await oauthClient().getAccessToken();
    const url = `${process.env.STRATO_NODE_URL}/strato-api/eth/v1.2/metadata`;
    const response = await apiGet(
        url,
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 },
        { logPrefix: 'NetworkConfig', apiUrl: url, method: 'GET' }
    );
    const id = response.data?.networkID;
    if (!id) {
        throw new Error('Failed to fetch networkID from STRATO metadata');
    }
    _networkId = String(id);
    logInfo('NetworkConfig', `Network ID: ${_networkId}`);
}

export function getNetworkId(): string {
    if (!_networkId) {
        throw new Error('networkId not initialized. Call initNetworkConfig() first.');
    }
    return _networkId;
}
