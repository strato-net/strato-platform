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
  CONTRACT_NAME_CHANGE,
  UPDATE_TOAST,
  RESET_ERROR,
  UPDATE_USING_SAMPLE_CONTRACT
} from './createContract.actions';

const initialState = {
  isOpen: false,
  contractCompileErrors: undefined,
  abi: undefined,
  response: "Status: Upload Contract",
  username: '',
  contract: '',
  contractName: undefined,
  createDisabled: true,
  filename: undefined,
  isToasts: false,
  toastsMessage: '',
  error: '',
  usingSampleContract: false
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case CONTRACT_OPEN_MODAL:
      return {
        isOpen: true,
        abi: '',
        response: "Status: Upload Contract",
        contract: '',
        contractName: '',
        createDisabled: true,
        filename: '',
        username: '',
        // createDisabled: true,
        usingSampleContract: false,
      };

    case USERNAME_FORM_CHANGE:
      return {
        ...state,
        username: action.name
      };

    case CONTRACT_CLOSE_MODAL:
      return {
        ...state,
        isOpen: false
      };

    case CONTRACT_NAME_CHANGE:
      return {
        ...state,
        contractName: action.contractName
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
        isToasts: action.toasts,
        toastsMessage: action.toastsMessage
      };
    case UPDATE_TOAST: 
      return {
        ...state,
        isToasts: action.toasts,
        toastsMessage: action.toastsMessage
      };
    case CREATE_CONTRACT_SUCCESS:
      return {
        ...state,
        isOpen: false,
        response: "Upload Success: " + action.response,
        isToasts: action.toasts,
        toastsMessage: action.response && action.response.status ? 'Contract Created' : action.response
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
      let contracts = action.response && action.response.src && Object.keys(action.response.src);
      return {
        ...state,
        isOpen: true,
        abi: action.response,
        createDisabled: false,
        contractName: contracts && contracts[0],
        contractCompileErrors: undefined,
      };
    case RESET_ERROR:
      return {
        ...state,
        isToasts: null,
        toastsMessage: null
      }
    case UPDATE_USING_SAMPLE_CONTRACT:
      return {
        ...state,
        usingSampleContract: action.usingSampleContract
      }
    default:
      return state;
  }
};

export default reducer;
