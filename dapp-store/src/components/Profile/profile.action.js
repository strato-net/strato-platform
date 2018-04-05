export const FETCH_ACCOUNT_DETAIL_REQUEST = 'FETCH_ACCOUNT_DETAIL_REQUEST';
export const FETCH_ACCOUNT_DETAIL_SUCCESS = 'FETCH_ACCOUNT_DETAIL_SUCCESS';
export const FETCH_ACCOUNT_DETAIL_FAILURE = 'FETCH_ACCOUNT_DETAIL_FAILURE';

export const fetchAccountDetail = function (address) {
  return {
    type: FETCH_ACCOUNT_DETAIL_REQUEST,
    address: address
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