export const VALIDATE_USER_REQUEST = "VALIDATE_USER_REQUEST";
export const VALIDATE_USER_SUCCESS = "VALIDATE_USER_SUCCESS";
export const VALIDATE_USER_FAILURE = "VALIDATE_USER_FAILURE";

export const validateUser = function(payload) {
  return {
    ...payload,
    type : VALIDATE_USER_REQUEST,
  }
};

export const validateUserSuccess = function(result) {
  return {
    result: result,
    type : VALIDATE_USER_SUCCESS,
  }
};

export const validateUserFailure = function(error) {
  return {
    error: error,
    type : VALIDATE_USER_FAILURE,
  }
};
