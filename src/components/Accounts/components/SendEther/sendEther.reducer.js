import {
  SEND_ETHER,
  SEND_ETHER_SUCCESS,
  SEND_ETHER_FAILURE,
  SEND_ETHER_OPEN_MODAL,
  SEND_ETHER_CLOSE_MODAL,
  FROM_USERNAME_CHANGE,
  TO_USERNAME_CHANGE
} from './sendEther.actions';

const initialState = {
  isOpen: false,
  toUsername: '',
  fromUsername: '',
};


const reducer = function (state = initialState, action) {
  switch (action.type) {
    case SEND_ETHER:
      return {
        from: action.from,
        fromAddress: action.fromAddress,
        password: action.password,
        to: action.to,
        toAddress: action.toAddress,
        value: action.value,
        isOpen: true,
      };
    case SEND_ETHER_SUCCESS:
      return {
        tx_receipt: action.tx_receipt,
        ...state
      };
    case SEND_ETHER_FAILURE:
      return {
        error: action.tx_receipt,
        ...state
      };
    case SEND_ETHER_OPEN_MODAL:
      return {
        ...state,
        isOpen: true,
      };
    case SEND_ETHER_CLOSE_MODAL:
      return {
        ...state,
        isOpen: false
      };
    case TO_USERNAME_CHANGE:
      return {
        toUsername: action.toUsername,
        ...state
      };
    case FROM_USERNAME_CHANGE:
      return {
        fromUsername: action.fromUsername,
        ...state
      };
    default:
      return state;
  }
};

export default reducer;
