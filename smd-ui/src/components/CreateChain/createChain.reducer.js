import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY,
  CREATE_CHAIN_REQUEST,
  CREATE_CHAIN_FAILURE,
  CREATE_CHAIN_SUCCESS,
} from './createChain.actions';

const initialState = {
  isOpen: false,
  spinning: false,
  key: null
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
    case CREATE_CHAIN_REQUEST:
      return {
        isOpen: true,
        spinning: true,
      };
    case CREATE_CHAIN_FAILURE:
      return {
        isOpen: false,
        spinning: false,
        error: action.error
      };
    case CREATE_CHAIN_SUCCESS:
      return {
        isOpen: false,
        spinning: false,
        key: action.key,
      };
    default:
      return state;
  }
};

export default reducer;