import axios, { AxiosRequestConfig } from 'axios';
import { logError } from './logger';
import { getBAUserToken } from '../auth';
import { config } from '../config';
import { RetryConfig, ClientOptions, ApiClient } from '../types';

export const extractErrorMessage = (error: any): string => {
  // API response errors
  if (error.response?.data) {
    const { data } = error.response;
    return data.error?.message 
      || data.message 
      || (typeof data.error === 'string' ? data.error : '')
      || JSON.stringify(data);
  }
  
  // Network errors
  return config.api.errorCodes[error.code] || error.message || 'Unknown error';
};

// ============================================================================
// Retry Logic
// ============================================================================

const retry = async <T>(
  fn: () => Promise<T>,
  { maxAttempts = config.api.defaults.maxAttempts, logPrefix = 'API' }: RetryConfig = {}
): Promise<T> => {
  let lastError: Error;
  
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = new Error(extractErrorMessage(error));
      
      if (i < maxAttempts) {
        logError(logPrefix, new Error(`Attempt ${i}/${maxAttempts} failed: ${lastError.message}`));
      }
    }
  }
  
  logError(logPrefix, new Error(`All ${maxAttempts} attempts failed: ${lastError!.message}`));
  throw lastError!;
};

// ============================================================================
// API Client Factory
// ============================================================================

const createClient = (
  baseURL: string, 
  { authenticated = true, timeout = config.api.defaults.timeout, logPrefix = 'API' }: ClientOptions = {}
): ApiClient => {
  
  const request = async <T>(
    method: 'get' | 'post',
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<T> => {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...config?.headers,
    };
    
    if (authenticated) {
      const token = await getBAUserToken();
      if (!token) throw new Error('No access token available');
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    // For external clients with empty baseURL, use the url directly
    const requestUrl = baseURL ? `${baseURL}${url}` : url;
    
    const { data: responseData } = await retry(
      () => axios.request<T>({
        method,
        url: requestUrl,
        data,
        headers,
        timeout,
        ...config,
      }),
      { logPrefix }
    );
    
    return responseData;
  };
  
  return {
    get: <T>(url: string, config?: AxiosRequestConfig) => 
      request<T>('get', url, undefined, config),
    
    post: <T>(url: string, data?: any, config?: AxiosRequestConfig) => 
      request<T>('post', url, data, config),
  };
};

// ============================================================================
// API Instances
// ============================================================================

export const cirrus = createClient(`${config.api.nodeUrl}/cirrus/search`, { logPrefix: 'Cirrus' });
export const strato = createClient(`${config.api.nodeUrl}/strato/v2.3`, { logPrefix: 'Strato' });
export const bloc = createClient(`${config.api.nodeUrl}/bloc/v2.2`, { logPrefix: 'Bloc' });
export const eth = createClient(`${config.api.nodeUrl}/strato-api/eth/v1.2`, { logPrefix: 'Eth' });
export const fetch = createClient('', { authenticated: false, logPrefix: 'Fetch' });

// ============================================================================
// Exports
// ============================================================================

export default {
  extractErrorMessage,
  createClient,
  cirrus,
  strato,
  bloc,
  eth,
  fetch,
};