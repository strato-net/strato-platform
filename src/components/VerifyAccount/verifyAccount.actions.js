export const OPEN_VERIFY_ACCOUNT_MODAL = 'OPEN_VERIFY_ACCOUNT_MODAL';
export const CLOSE_VERIFY_ACCOUNT_MODAL = 'CLOSE_VERIFY_ACCOUNT_MODAL';
export const VERIFY_OTP_REQUEST = 'VERIFY_OTP_REQUEST';
export const VERIFY_OTP_SUCCESS = 'VERIFY_OTP_SUCCESS';
export const VERIFY_OTP_FAILURE = 'VERIFY_OTP_FAILURE';

export const openVerifyAccountModal = function () {
  return {
    type: OPEN_VERIFY_ACCOUNT_MODAL
  }
}

export const closeVerifyAccountModal = function () {
  return {
    type: CLOSE_VERIFY_ACCOUNT_MODAL
  }
}

export const verifyOTP = function (data) {
  return {
    type: VERIFY_OTP_REQUEST,
    OTP: data.OTP
  }
}

export const verifyOTPSuccess = function () {
  return {
    type: VERIFY_OTP_SUCCESS,
    isOTPVerified: true
  }
}

export const verifyOTPFailure = function (error) {
  return {
    type: VERIFY_OTP_FAILURE,
    isOTPVerified: false,
    error
  }
}
