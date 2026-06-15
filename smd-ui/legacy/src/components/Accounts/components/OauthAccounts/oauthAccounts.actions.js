export const FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST = 'FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST';
export const FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS = 'FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS';
export const FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE = 'FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE';
export const OAUTH_ACCOUNTS_FILTER = 'OAUTH_ACCOUNTS_FILTER';
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

export const oauthAccountsFilter = function (filter) {
  return {
    type: OAUTH_ACCOUNTS_FILTER,
    filter
  }
};
