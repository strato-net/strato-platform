export const FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST = 'FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST';
export const FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS = 'FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS';
export const FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE = 'FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE';
export const OAUTH_FAUCET_REQUEST = 'OAUTH_FAUCET_REQUEST';
export const OAUTH_FAUCET_SUCCESS = 'OAUTH_FAUCET_SUCCESS';
export const OAUTH_FAUCET_FAILURE = 'OAUTH_FAUCET_FAILURE';

export const RESET_OAUTH_USER_ACCOUNT = 'RESET_OAUTH_USER_ACCOUNT';

export function fetchOauthAccountDetail(name, address, chainId) {
  return {
    type: FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST,
    name: name,
    address: address,
    chainId: chainId
  }
}

export const fetchOauthAccountDetailSuccess = function (account) {
  return {
    type: FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS,
    account
  }
};

export const fetchOauthAccountDetailFailure = function (error) {
  return {
    type: FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE,
    error: error
  }
};

export const resetOauthUserAccount = function () {
  return {
    type: RESET_OAUTH_USER_ACCOUNT
  }
};

export const oauthFaucetRequest = function (name, address, chainId) {
  return {
    type: OAUTH_FAUCET_REQUEST,
    name,
    address,
    chainId
  }
}

export const oauthFaucetSuccess = function () {
  return {
    type: OAUTH_FAUCET_SUCCESS
  }
}

export const oauthFaucetFailure = function (err) {
  return {
    type: OAUTH_FAUCET_FAILURE,
    err
  }
}