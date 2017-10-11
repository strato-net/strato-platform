export const VERIFY_ACCOUNT = 'VERIFY_ACCOUNT';
export const HANDLE_ACCOUNT_SUCCESS = 'HANDLE_ACCOUNT_SUCCESS';
export const HANDLE_ACCOUNT_FAILURE = 'HANDLE_ACCOUNT_FAILURE';
export const LOGOUT_ACCOUNT = 'LOGOUT_ACCOUNT';
export const LOGOUT_ACCOUNT_SUCCESS = 'LOGOUT_ACCOUNT_SUCCESS';

export const verifyAccount = function (payload) {
  return {
    type: VERIFY_ACCOUNT,
    email: payload.email,
    password: payload.password
  }
}

export const handleAccountSuccess = function (email, response) {
  return {
    type: HANDLE_ACCOUNT_SUCCESS,
    email,
    currentUser: response
  }
}

export const handleAccountFailure = function (email, error) {
  return {
    type: HANDLE_ACCOUNT_FAILURE,
    email,
    error
  }
}

export const logout = function () {
  return {
    type: LOGOUT_ACCOUNT
  }
}

export const logoutSuccess = function () {
  return {
    type: LOGOUT_ACCOUNT_SUCCESS
  }
}