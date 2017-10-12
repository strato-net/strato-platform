import {
  CONTRACT_OPEN_MODAL,
  CONTRACT_CLOSE_MODAL,
  CREATE_CONTRACT_REQUEST,
  CREATE_CONTRACT_SUCCESS,
  CREATE_CONTRACT_FAILURE,
  COMPILE_CONTRACT_REQUEST,
  COMPILE_CONTRACT_FAILURE,
  COMPILE_CONTRACT_SUCCESS,
  USERNAME_FORM_CHANGE,
  CONTRACT_FORM_CHANGE,
} from './createContract.actions';

const initialState = {
  isOpen: false,
  contractCompileErrors: undefined,
  abi: undefined,
  response: "Status: Upload Contract",
  username: '',
  contract: '',
  filename: undefined,
};


const reducer = function (state = initialState, action) {
  switch (action.type) {
    case CONTRACT_OPEN_MODAL:
      return {
        isOpen: true,
        abi: '',
        response: "Status: Upload Contract",
        contract: '',
        filename: '',
        username: '',
        // createDisabled: true,
      };
    case CONTRACT_CLOSE_MODAL:
      return initialState;
    case USERNAME_FORM_CHANGE:
      return {
        ...state,
        username: action.name
      };
    case CONTRACT_FORM_CHANGE:
      return {
        ...state,
        contract: action.contract,
        filename: action.name,
        contractCompileErrors: undefined,
      };
    case CREATE_CONTRACT_REQUEST:
      return {
        ...state,
        isOpen: true,
        response: "Uploading Contract..."
      };
    case CREATE_CONTRACT_FAILURE:
      return {
        ...state,
        isOpen: true,
        response: "Error Uploading Contract...: " + action.error,
        error: action.error,
      };
    case CREATE_CONTRACT_SUCCESS:
      return {
        ...state,
        isOpen: false,
        response: "Upload Success: " + action.response,
      };
    case COMPILE_CONTRACT_REQUEST:
      return {
        ...state,
        isOpen: true,
        response: "Uploading Contract...",
      };
    case COMPILE_CONTRACT_FAILURE:
      return {
        ...state,
        isOpen: true,
        response: "Error Uploading Contract...: " + action.error,
        error: action.error,
        contractCompileErrors: `Unable to compile contract: ${action.error}`,
      };
    case COMPILE_CONTRACT_SUCCESS:
      return {
        ...state,
        isOpen: true,
        abi: action.response,
        contractCompileErrors: undefined,
      };
    default:
      return state;
  }
};

export default reducer;
