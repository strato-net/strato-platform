// src/services/apiClient.js
const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

const apiClient = axios.create({
  baseURL: `https://${config.marketplaceUrl}/strato/v2.3`,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 seconds timeout
});

// Interceptor to attach Authorization header
apiClient.interceptors.request.use(
  async (requestConfig) => {
    // Assume getToken is a function that retrieves the latest token
    const token = await getUserToken(); // You need to implement getUserToken
    requestConfig.headers.Authorization = `Bearer ${token}`;
    return requestConfig;
  },
  (error) => {
    logger.error(`API Client Request Error: ${error.message}`);
    return Promise.reject(error);
  }
);

// Function to handle API errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    logger.error(`API Client Response Error: ${error.message}`);
    return Promise.reject(error);
  }
);

// Placeholder for getUserToken
const getUserToken = async () => {
  // Implement your token retrieval logic here
  // For example, fetch from a token service or cache
  return 'your-token';
};

module.exports = apiClient;