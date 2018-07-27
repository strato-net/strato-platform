export const FETCH_CHAINS = 'FETCH_CHAINS';
export const FETCH_CHAINSS_SUCCESSFULL = 'FETCH_CHAINSS_SUCCESSFULL';
export const FETCH_CHAINSS_FAILED = 'FETCH_CHAINS_FAILED';

export const fetchChains = function (chainid) {
  return {
    type: FETCH_CHAINS,
    chainId: chainId,
  }
};

export const fetchChainsSuccess = function (chains) {
  return {
    type: FETCH_CHAINS_SUCCESSFULL,
    chains: chains
  }
};

export const fetchChainsFailure = function (error) {
  return {
    type: FETCH_CHAINS_FAILED,
    error: error,
  }
};