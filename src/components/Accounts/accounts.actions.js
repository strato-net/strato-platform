export const FETCH_ACCOUNTS = 'FETCH_ACCOUNTS';
export const FETCH_ACCOUNTS_SUCCESS = 'FETCH_ACCOUNTS_SUCCESS';
export const FETCH_ACCOUNTS_FAILURE = 'FETCH_ACCOUNTS_FAILURE';

export const fetchAccounts = function () {
  return {
    type: FETCH_ACCOUNTS,
  }
};

export const fetchAccountsSuccess = function (res) {
  return {
    type: FETCH_ACCOUNTS_SUCCESS,
    accounts: res
  }
};

export const fetchAccountsFailure = function (error) {
  return {
    type: FETCH_ACCOUNTS_FAILURE,
    error: error,
  }
};
