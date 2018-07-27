export const FETCH_CHAINS = 'FETCH_CHAINS';
export const FETCH_CHAINS_SUCCESSFULL = 'FETCH_CHAINS_SUCCESSFULL';
export const FETCH_CHAINS_FAILED = 'FETCH_CHAINS_FAILED';

export const fetchChains = function (chainid) {
  return {
    type: FETCH_CHAINS,
    chainid: chainid,
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