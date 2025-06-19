const axios = require("axios");
const logger = require("./logger");
const { getUserToken } = require("../auth");
const { marketplaceUrl } = require("../config");

/**
 * Function to create an Axios API client
 * @param {string} baseURL - The base URL for the API
 * @returns {AxiosInstance} Configured Axios client
 */
const createApiClient = (baseURL) => {
  const client = axios.create({
    baseURL,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    timeout: 60000, // Timeout set to 60 seconds
  });

  // Request interceptor to attach Authorization token
  client.interceptors.request.use(
    async (config) => {
      try {
        const token = await getUserToken();
        config.headers.Authorization = `Bearer ${token}`;
        return config;
      } catch (error) {
        logger.error(`Failed to attach Authorization token: ${error.message}`);
        return Promise.reject(error);
      }
    },
    (error) => {
      logger.error(`API Request Error: ${error.message}`);
      return Promise.reject(error);
    }
  );

  // Response interceptor to handle and log errors
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response) {
        logger.error(
          `API Response Error [${error.response.status}]: ${error.response.statusText}`
        );
      } else {
        logger.error(`API Network Error: ${error.message}`);
      }
      return Promise.reject(error);
    }
  );

  return client;
};

// Initialize API clients
const networkApiClient = createApiClient(
  `https://${marketplaceUrl}/strato/v2.3`
);
const dbApiClient = createApiClient(`https://${marketplaceUrl}/cirrus/search`);

module.exports = { networkApiClient, dbApiClient };
