export const SEND_ETHER = "SEND_ETHER";
export const SEND_ETHER_SUCCESS = "SEND_ETHER_SUCCESS";
export const SEND_ETHER_FAILURE = "SEND_ETHER_FAILURE";
export const SEND_ETHER_OPEN_MODAL = "SEND_ETHER_OPEN_MODAL";
export const SEND_ETHER_CLOSE_MODAL = "SEND_ETHER_CLOSE_MODAL";
export const FROM_USERNAME_CHANGE = 'FROM_USERNAME_CHANGE';
export const TO_USERNAME_CHANGE = 'TO_USERNAME_CHANGE';

export const sendEther = function(payload) {
  return {
    ...payload,
    type : SEND_ETHER,
  }
};

export const fromUsernameChange = function(from) {
  return {
    from,
    type: FROM_USERNAME_CHANGE
  }
};

export const toUsernameChange = function(to) {
  return {
    to,
    type: TO_USERNAME_CHANGE
  }
};

export const sendEtherSuccess = function(tx_receipt) {
  return {
    tx_receipt,
    type : SEND_ETHER,
  }
};

export const sendEtherFailure = function(error) {
  return {
    error,
    type : SEND_ETHER,
  }
};

export const sendEtherOpenModal = function() {
  return {
    type: SEND_ETHER_OPEN_MODAL,
    isOpen: true
  }
}

export const sendEtherCloseModal = function() {
  return {
    type: SEND_ETHER_CLOSE_MODAL,
    isOpen: false
  }
}