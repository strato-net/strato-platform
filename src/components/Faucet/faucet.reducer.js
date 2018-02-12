import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY,
  FAUCET_REQUEST,
  FAUCET_FAILURE,
  FAUCET_SUCCESS,
} from './faucet.actions';

const initialState = {
  isTokenOpen: false,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_OVERLAY:
      return {
        isTokenOpen: true,
      };
    case CLOSE_OVERLAY:
      return {
        isTokenOpen: false
      };
    case FAUCET_REQUEST:
      return {
        isTokenOpen: true,
        spinning: true,
      };
    case FAUCET_FAILURE:
      return {
        isTokenOpen: false,
        spinning: false,
        error: action.error
      };
    case FAUCET_SUCCESS:
      return {
        isTokenOpen: false,
        spinning: false,
        response: action.response,
      };
    default:
      return state;
  }
};

export default reducer;