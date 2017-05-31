import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY,
  CREATE_CONTRACT,
  CREATE_CONTRACT_SUCCESS,
  CREATE_CONTRACT_FAILURE,
} from './createContract.actions';

const initialState = {
  isOpen: false,
  spinning: false,
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
    case CREATE_CONTRACT:
      return {
        isOpen: true,
        spinning: true
      };
    case CREATE_CONTRACT_FAILURE:
      return {
        isOpen: false,
        spinning: false,
        error: action.error
      };
    case CREATE_CONTRACT_SUCCESS:
      return {
        isOpen: false,
        spinning: false,
        key: action.key
      };
    default:
      return state;
  }
};

export default reducer;