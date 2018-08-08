
export const SIGN_REQUEST = 'SIGN_REQUEST';
export const SIGN_REQUEST_SUCCESS = 'SIGN_REQUESTQUEST_SUCCESS';
export const SIGN_REQUEST_FAILURE = 'SIGN_REQUEST_FAILURE';
export const RESET_ERROR = 'RESET_ERROR';

export const signPayload = function (payload) {
  return {
    type: SIGN_REQUEST,
    payload,
  }
}

export const signPayloadSuccess = function (response) {
  return {
    type: SIGN_REQUEST_SUCCESS,
    signedPayload: response
  }
}

export const signPayloadFailure = function (error) {
  return {
    type: SIGN_REQUEST_FAILURE,
    signedPayloadError: error
  }
}

export const resetError = function (error) {
  return {
    type: RESET_ERROR
  }
}


