export const FETCH_ACCOUNTS = 'FETCH_ACCOUNTS';
export const FETCH_ACCOUNTS_SUCCESSFULL = 'FETCH_ACCOUNTS_SUCCESSFULL';
export const FETCH_ACCOUNTS_FAILED = 'FETCH_ACCOUNTS_FAILED';
export const CHANGE_ACCOUNT_FILTER = 'CHANGE_ACCOUNT_FILTER';
export const FETCH_ACCOUNT_ADDRESS_REQUEST = 'FETCH_ACCOUNT_ADDRESS_REQUEST';
export const FETCH_USER_ADDRESSES_SUCCESSFUL = 'FETCH_ACCOUNT_ADDRESS_SUCCESS';
export const FETCH_USER_ADDRESSES_FAILED = 'FETCH_ACCOUNT_ADDRESS_FAILURE';
export const FETCH_ACCOUNT_DETAIL_REQUEST = 'FETCH_ACCOUNT_DETAIL_REQUEST';
export const FETCH_ACCOUNT_DETAIL_SUCCESS = 'FETCH_ACCOUNT_DETAIL_SUCCESS';
export const FETCH_ACCOUNT_DETAIL_FAILURE = 'FETCH_ACCOUNT_DETAIL_FAILURE';
export const RESET_ACCOUNT_ADDRESS = 'RESET_ACCOUNT_ADDRESS';
export const GET_BALANCE = 'GET_BALANCE';
export const BALANCE_SUCCESS = 'BALANCE_SUCCESS';
export const BALANCE_FAILURE = 'BALANCE_FAILURE';
export const FETCH_CURRENT_ACCOUNT_DETAIL_REQUEST = 'FETCH_CURRENT_ACCOUNT_DETAIL_REQUEST';
export const FETCH_CURRENT_ACCOUNT_DETAIL_SUCCESS = 'FETCH_CURRENT_ACCOUNT_DETAIL_SUCCESS';
export const FETCH_CURRENT_ACCOUNT_DETAIL_FAILURE = 'FETCH_CURRENT_ACCOUNT_DETAIL_FAILURE';
export const FETCH_OAUTH_ACCOUNTS_REQUEST = 'FETCH_OAUTH_ACCOUNTS_REQUEST';
export const FETCH_OAUTH_ACCOUNTS_SUCCESS = 'FETCH_OAUTH_ACCOUNTS_SUCCESS';
export const FETCH_OAUTH_ACCOUNTS_FAILURE = 'FETCH_OAUTH_ACCOUNTS_FAILURE';

export const fetchAccounts = function (loadAddresses, loadBalances, chainId) {
  return {
    type: FETCH_ACCOUNTS,
    loadAddresses: loadAddresses,
    loadBalances: loadBalances,
    chainId: chainId
  }
};

export const fetchAccountsSuccess = function (accounts) {
  return {
    type: FETCH_ACCOUNTS_SUCCESSFULL,
    accounts: accounts
  }
};

export const fetchAccountsFailure = function (error) {
  return {
    type: FETCH_ACCOUNTS_FAILED,
    error: error,
  }
};

export const changeAccountFilter = function (filter) {
  return {
    type: CHANGE_ACCOUNT_FILTER,
    filter: filter
  }
};

export const fetchUserAddresses = function (name, loadBalances, chainId) {
  return {
    type: FETCH_ACCOUNT_ADDRESS_REQUEST,
    name: name,
    loadBalances: loadBalances,
    chainId: chainId
  }
};

export const resetUserAddress = function (name) {
  return {
    type: RESET_ACCOUNT_ADDRESS,
    name: name
  }
}

export const fetchUserAddressesSuccess = function (name, addresses) {
  return {
    type: FETCH_USER_ADDRESSES_SUCCESSFUL,
    name: name,
    addresses: addresses
  }
};

export const fetchUserAddressesFailure = function (name, error) {
  return {
    type: FETCH_USER_ADDRESSES_FAILED,
    name: name,
    error: error
  }
};

export const fetchAccountDetail = function (name, address, chainId, flag) {
  return {
    type: FETCH_ACCOUNT_DETAIL_REQUEST,
    name: name,
    address: address,
    chainId: chainId,
    flag: flag
  }
};

export const fetchAccountDetailSuccess = function (name, address, detail) {
  return {
    type: FETCH_ACCOUNT_DETAIL_SUCCESS,
    name: name,
    address: address,
    detail: detail
  }
};

export const fetchAccountDetailFailure = function (name, address, error) {
  return {
    type: FETCH_ACCOUNT_DETAIL_FAILURE,
    name: name,
    address: address,
    error: error
  }
};

export const fetchBalanceRequest = function (address) {
  return {
    type: GET_BALANCE,
    address
  }
}

export const fetchBalanceSuccess = function (detail) {
  return {
    type: BALANCE_SUCCESS,
    detail
  }
};

export const fetchBalanceFailure = function (error) {
  return {
    type: BALANCE_FAILURE,
    error
  }
};

export const fetchCurrentAccountDetail = function (address) {
  return {
    type: FETCH_CURRENT_ACCOUNT_DETAIL_REQUEST,
    address: address
  }
};

export const fetchCurrentAccountDetailSuccess = function (address, detail) {
  return {
    type: FETCH_CURRENT_ACCOUNT_DETAIL_SUCCESS,
    address: address,
    detail: detail
  }
};

export const fetchCurrentAccountDetailFailure = function (address, error) {
  return {
    type: FETCH_CURRENT_ACCOUNT_DETAIL_FAILURE,
    address: address,
    error: error
  }
};

export const fetchOauthAccounts = function () {
  return {
    type: FETCH_OAUTH_ACCOUNTS_REQUEST
  }
};

export const fetchOauthAccountsSuccess = function (data) {
  return {
    type: FETCH_OAUTH_ACCOUNTS_SUCCESS,
    data
  }
};

export const fetchOauthAccountsFailure = function () {
  return {
    type: FETCH_OAUTH_ACCOUNTS_FAILURE
  }
};
