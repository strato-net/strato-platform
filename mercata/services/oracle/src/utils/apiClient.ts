import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { logError } from './logger';
import { RetryConfig } from '../types';
import { healthMonitor } from './healthMonitor';
import { DEFAULT_RETRY_CONFIG } from './constants';

function extractErrorMessage(error: any): string {
    // Extract error message from different API response formats
    if (error.response?.data) {
        const data = error.response.data;
        
        // Common API error formats
        if (data.error?.message) {
            return data.error.message;
        }
        if (data.message) {
            return data.message;
        }
        if (data.error) {
            return typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
        }
        if (data.success === false && data.error) {
            return data.error.message || data.error;
        }
        
        // Fallback to full response data
        return JSON.stringify(data);
    }
    
    // Network or other errors
    if (error.code === 'ECONNREFUSED') {
        return 'Connection refused';
    }
    if (error.code === 'ENOTFOUND') {
        return 'DNS lookup failed';
    }
    if (error.code === 'ETIMEDOUT') {
        return 'Request timeout';
    }
    
    return error.message || 'Unknown error';
}

async function withRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            const errorMessage = extractErrorMessage(error);
            
            if (attempt === config.maxAttempts) {
                logError(config.logPrefix, new Error(`All ${config.maxAttempts} attempts failed. Last error: ${errorMessage}`));
                healthMonitor.recordFailure(`API call failed after ${config.maxAttempts} attempts: ${errorMessage}`);
                throw new Error(errorMessage);
            }
            logError(config.logPrefix, new Error(`Attempt ${attempt} failed: ${errorMessage}`));
        }
    }
    throw new Error('Unexpected retry loop exit');
}

export async function apiGet<T = any>(
    url: string,
    config?: AxiosRequestConfig,
    retryConfig?: Partial<RetryConfig>
): Promise<AxiosResponse<T>> {
    return withRetry(
        async () => {
            return await axios.get(url, config);
        },
        { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
    );
}

export async function apiPost<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    retryConfig?: Partial<RetryConfig>
): Promise<AxiosResponse<T>> {
    return withRetry(
        async () => {
            return await axios.post(url, data, config);
        },
        { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
    );
}

export async function apiRequest<T = any>(
    requestConfig: AxiosRequestConfig,
    retryConfig?: Partial<RetryConfig>
): Promise<AxiosResponse<T>> {
    return withRetry(
        async () => {
            return await axios(requestConfig);
        },
        { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
    );
}
