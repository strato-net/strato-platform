export const SEND_TOKENS_REQUEST = "SEND_TOKENS_REQUEST";
export const SEND_TOKENS_SUCCESS = "SEND_TOKENS_SUCCESS";
export const SEND_TOKENS_FAILURE = "SEND_TOKENS_FAILURE";
export const SEND_TOKENS_OPEN_MODAL = "SEND_TOKENS_OPEN_MODAL";
export const SEND_TOKENS_CLOSE_MODAL = "SEND_TOKENS_CLOSE_MODAL";
export const FROM_USERNAME_CHANGE = 'FROM_USERNAME_CHANGE';
export const TO_USERNAME_CHANGE = 'TO_USERNAME_CHANGE';

export const fromUsernameChange = function(from) {
  return {
    fromUsername: from,
    type: FROM_USERNAME_CHANGE
  }
};

export const toUsernameChange = function(to) {
  return {
    toUsername: to,
    type: TO_USERNAME_CHANGE
  }
};

export const sendTokens = function(payload) {
  return {
    ...payload,
    type : SEND_TOKENS_REQUEST,
  }
};

export const sendTokensSuccess = function(result) {
  return {
    result: result,
    type : SEND_TOKENS_SUCCESS,
  }
};

export const sendTokensFailure = function(error) {
  return {
    error: error,
    type : SEND_TOKENS_FAILURE,
  }
};

export const sendTokensOpenModal = function() {
  return {
    type: SEND_TOKENS_OPEN_MODAL,
    isOpen: true
  }
}

export const sendTokensCloseModal = function() {
  return {
    type: SEND_TOKENS_CLOSE_MODAL,
    isOpen: false
  }
}
