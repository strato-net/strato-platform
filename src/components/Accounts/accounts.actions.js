export const FETCH_ACCOUNTS_REQUEST = 'FETCH_ACCOUNTS_REQUEST';
export const FETCH_ACCOUNTS_SUCCESS = 'FETCH_ACCOUNTS_SUCCESS';
export const FETCH_ACCOUNTS_FAILURE = 'FETCH_ACCOUNTS_FAILURE';
export const CHANGE_ACCOUNT_FILTER = 'CHANGE_ACCOUNT_FILTER';
export const FETCH_ACCOUNT_ADDRESS_REQUEST = 'FETCH_ACCOUNT_ADDRESS_REQUEST';
export const FETCH_USER_ADDRESSES_SUCCESS = 'FETCH_ACCOUNT_ADDRESS_SUCCESS';
export const FETCH_USER_ADDRESSES_FAILURE = 'FETCH_ACCOUNT_ADDRESS_FAILURE';
export const FETCH_ACCOUNT_DETAIL_REQUEST = 'FETCH_ACCOUNT_DETAIL_REQUEST';
export const FETCH_ACCOUNT_DETAIL_SUCCESS = 'FETCH_ACCOUNT_DETAIL_SUCCESS';
export const FETCH_ACCOUNT_DETAIL_FAILURE = 'FETCH_ACCOUNT_DETAIL_FAILURE';

export const fetchAccounts = function () {
  return {
    type: FETCH_ACCOUNTS_REQUEST,
  }
};

export const fetchAccountsSuccess = function (accounts) {
  return {
    type: FETCH_ACCOUNTS_SUCCESS,
    accounts: accounts
  }
};

export const fetchAccountsFailure = function (error) {
  return {
    type: FETCH_ACCOUNTS_FAILURE,
    error: error,
  }
};

export const changeAccountFilter = function(filter) {
  return {
    type: CHANGE_ACCOUNT_FILTER,
    filter: filter
  }
};

export const fetchUserAddresses = function (name) {
  return {
    type: FETCH_ACCOUNT_ADDRESS_REQUEST,
    name: name
  }
};

export const fetchUserAddressesSuccess = function (name, addresses) {
  return {
    type: FETCH_USER_ADDRESSES_SUCCESS,
    name: name,
    addresses: addresses
  }
};

export const fetchUserAddressesFailure = function (name, error) {
  return {
    type: FETCH_USER_ADDRESSES_FAILURE,
    name: name,
    error: error
  }
};

export const fetchAccountDetail = function(name, address) {
  return {
    type: FETCH_ACCOUNT_DETAIL_REQUEST,
    name: name,
    address: address
  }
};

export const fetchAccountDetailSuccess = function(name, address, detail) {
  return {
    type: FETCH_ACCOUNT_DETAIL_SUCCESS,
    name: name,
    address: address,
    detail: detail
  }
};

export const fetchAccountDetailFailure = function(name, address, error) {
  return {
    type: FETCH_ACCOUNT_DETAIL_FAILURE,
    name: name,
    address: address,
    error: error
  }
};
