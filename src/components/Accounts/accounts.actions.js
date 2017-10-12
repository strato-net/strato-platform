export const FETCH_ACCOUNTS = 'FETCH_ACCOUNTS';
export const FETCH_ACCOUNTS_SUCCESSFULL = 'FETCH_ACCOUNTS_SUCCESSFULL';
export const FETCH_ACCOUNTS_FAILED = 'FETCH_ACCOUNTS_FAILED';
export const CHANGE_ACCOUNT_FILTER = 'CHANGE_ACCOUNT_FILTER';
export const FETCH_ACCOUNT_ADDRESS = 'FETCH_ACCOUNT_ADDRESS';
export const FETCH_USER_ADDRESSES_SUCCESSFUL = 'FETCH_ACCOUNT_ADDRESS_SUCCESS';
export const FETCH_USER_ADDRESSES_FAILED = 'FETCH_ACCOUNT_ADDRESS_FAILURE';
export const FETCH_ACCOUNT_DETAIL = 'FETCH_ACCOUNT_DETAIL';
export const FETCH_ACCOUNT_DETAIL_SUCCESSFULL = 'FETCH_ACCOUNT_DETAIL_SUCCESSFULL';
export const FETCH_ACCOUNT_DETAIL_FAILED = 'FETCH_ACCOUNT_DETAIL_FAILED';
export const FAUCET_REQUEST = "FAUCET_REQUEST";
export const FAUCET_SUCCESS = "FAUCET_SUCCESS";
export const FAUCET_FAILURE = "FAUCET_FAILURE";

export const fetchAccounts = function () {
  return {
    type: FETCH_ACCOUNTS,
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

export const changeAccountFilter = function(filter) {
  return {
    type: CHANGE_ACCOUNT_FILTER,
    filter: filter
  }
};

export const fetchUserAddresses = function (name) {
  return {
    type: FETCH_ACCOUNT_ADDRESS,
    name: name
  }
};

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

export const fetchAccountDetail = function(name, address) {
  return {
    type: FETCH_ACCOUNT_DETAIL,
    name: name,
    address: address
  }
};

export const fetchAccountDetailSuccess = function(name, address, detail) {
  return {
    type: FETCH_ACCOUNT_DETAIL_SUCCESSFULL,
    name: name,
    address: address,
    detail: detail
  }
};

export const fetchAccountDetailFailure = function(name, address, error) {
  return {
    type: FETCH_ACCOUNT_DETAIL_FAILED,
    name: name,
    address: address,
    error: error
  }
};


export const faucetRequest = function(address) {
  return {
    type: FAUCET_REQUEST,
    address: address
  }
};

export const faucetSuccess = function() {
  return {
    type: FAUCET_SUCCESS
  }
};

export const faucetFailure = function(err) {
  return {
    type: FAUCET_FAILURE,
    error: err
  }
};
