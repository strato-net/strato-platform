import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY,
  CREATE_CONTRACT,
  CREATE_CONTRACT_SUCCESS,
  CREATE_CONTRACT_FAILURE,
  COMPILE_CONTRACT,
  COMPILE_CONTRACT_FAILURE,
  COMPILE_CONTRACT_SUCCESS
} from './createContract.actions';

const initialState = {
  isOpen: false,
  compileSuccess: false,
  abi: '',
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
        compileSuccess: true,
        response: "Uploading Contract..."
      };
    case CREATE_CONTRACT_FAILURE:
      return {
        isOpen: true,
        compileSuccess: false,
        response: "Error Uploading Contract...: " + action.error,
        error: action.error
      };
    case CREATE_CONTRACT_SUCCESS:
      return {
        isOpen: false,
        compileSuccess: false,
        response: "Upload Success: " + action.response,
      };
    case COMPILE_CONTRACT:
      return {
        isOpen: true,
        compileSuccess: false,
        response: "Uploading Contract..."
      };
    case COMPILE_CONTRACT_FAILURE:
      return {
        isOpen: true,
        compileSuccess: false,
        response: "Error Uploading Contract...: " + action.error,
        error: action.error
      };
    case COMPILE_CONTRACT_SUCCESS:
      return {
        isOpen: true,
        compileSuccess: true,
        abi: action.response,
      };
    default:
      return state;
  }
};

export default reducer;