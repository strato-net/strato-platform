export const VERIFY_TEMPORARY_PASSWORD_REQUEST = 'VERIFY_TEMPORARY_PASSWORD_REQUEST';
export const VERIFY_TEMPORARY_PASSWORD_SUCCESS = 'VERIFY_TEMPORARY_PASSWORD_SUCCESS';
export const VERIFY_TEMPORARY_PASSWORD_FAILURE = 'VERIFY_TEMPORARY_PASSWORD_FAILURE';
export const RESET_ERROR = 'RESET_ERROR';
export const RESET_TEMPORARY_PASSWORD = 'RESET_TEMPORARY_PASSWORD';

export const verifyTempPassword = function (data, email) {
  return {
    type: VERIFY_TEMPORARY_PASSWORD_REQUEST,
    tempPassword: data.tempPassword,
    email
  }
}

export const verifyTempPasswordSuccess = function (data) {
  return {
    type: VERIFY_TEMPORARY_PASSWORD_SUCCESS,
    isTempPasswordVerified: data
  }
}

export const verifyTempPasswordFailure = function (error) {
  return {
    type: VERIFY_TEMPORARY_PASSWORD_FAILURE,
    error
  }
}

export const resetError = function (error) {
  return {
    type: RESET_ERROR
  }
}

export const resetTemporarypassword = function () {
  return {
    type: RESET_TEMPORARY_PASSWORD
  }
}