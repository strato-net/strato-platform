import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY,
  FAUCET_REQUEST,
  FAUCET_FAILURE,
  FAUCET_SUCCESS,
} from './faucet.actions';

const initialState = {
  isOpen: false,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_OVERLAY:
      return {
        isOpen: true,
      };
    case CLOSE_OVERLAY:
      return {
        isOpen: false
      };
    case FAUCET_REQUEST:
      return {
        isOpen: true,
        spinning: true,
      };
    case FAUCET_FAILURE:
      return {
        isOpen: false,
        spinning: false,
        error: action.error
      };
    case FAUCET_SUCCESS:
      return {
        isOpen: false,
        spinning: false,
        response: action.response,
      };
  default:
  return state;
}
};

export default reducer;