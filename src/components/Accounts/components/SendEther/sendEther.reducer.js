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
  result: 'Waiting to send...'
};


const reducer = function (state = initialState, action) {
  switch (action.type) {
    case SEND_ETHER:
      return {
        ...state,
        from: action.from,
        fromAddress: action.fromAddress,
        password: action.password,
        to: action.to,
        toAddress: action.toAddress,
        value: action.value,
        isOpen: true,
        result: 'Sending...',
      };
    case SEND_ETHER_SUCCESS:
      return {
        ...state,
        result: ['Send success\n' + JSON.stringify(action.result).replace(",", "\n")]
      };
    case SEND_ETHER_FAILURE:
      return {
        ...state,
        result: action.error
      };
    case SEND_ETHER_OPEN_MODAL:
      return {
        ...state,
        isOpen: true,
      };
    case SEND_ETHER_CLOSE_MODAL:
      return {
        isOpen: false
      };
    case TO_USERNAME_CHANGE:
      return {
        ...state,
        toUsername: action.toUsername
      };
    case FROM_USERNAME_CHANGE:
      return {
        ...state,
        fromUsername: action.fromUsername
      };
    default:
      return state;
  }
};

export default reducer;
