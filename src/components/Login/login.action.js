export const VALIDATE_USER_REQUEST = "VALIDATE_USER_REQUEST";
export const VALIDATE_USER_SUCCESS = "VALIDATE_USER_SUCCESS";
export const VALIDATE_USER_FAILURE = "VALIDATE_USER_FAILURE";
export const RESET_LOGIN_MESSAGE = "RESET_LOGIN_MESSAGE";
export const RESET_REDIRECT_REFER_LOGIN = "RESET_REDIRECT_REFER_LOGIN";

export const validateUser = function (payload) {
  return {
    ...payload,
    type: VALIDATE_USER_REQUEST,
  }
};

export const validateUserSuccess = function (result, username, address) {
  return {
    result: result,
    username,
    address,
    type: VALIDATE_USER_SUCCESS,
  }
};

export const validateUserFailure = function (error) {
  return {
    error: error,
    type: VALIDATE_USER_FAILURE,
  }
};

export const resetLoginMessage = function () {
  return {
    type: RESET_LOGIN_MESSAGE,
  }
};

export const resetRedirectRefer = function () {
  return {
    type: RESET_REDIRECT_REFER_LOGIN
  }
}
