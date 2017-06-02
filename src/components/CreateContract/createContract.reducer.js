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
  response: "Status: Upload Contract"
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
        spinning: true,
        response: "Uploading Contract..."
      };
    case CREATE_CONTRACT_FAILURE:
      return {
        isOpen: true,
        spinning: false,
        response: "Error Uploading Contract...: " + action.error,
        error: action.error
      };
    case CREATE_CONTRACT_SUCCESS:
      return {
        isOpen: true,
        spinning: false,
        response: "Upload Success: " + action.response,
      };
    default:
      return state;
  }
};

export default reducer;