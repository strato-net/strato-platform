import {
  CONTRACT_OPEN_MODAL,
  CONTRACT_CLOSE_MODAL,
  CREATE_CONTRACT,
  CREATE_CONTRACT_SUCCESS,
  CREATE_CONTRACT_FAILURE,
  COMPILE_CONTRACT,
  COMPILE_CONTRACT_FAILURE,
  COMPILE_CONTRACT_SUCCESS,
  USERNAME_FORM_CHANGE,
  PASSWORD_FORM_CHANGE,
  CONTRACT_FORM_CHANGE,
  ADDRESS_FORM_CHANGE,
} from './createContract.actions';

const initialState = {
  isOpen: false,
  compileSuccess: false,
  abi: '',
  response: "Status: Upload Contract",
  username: '',
  address: '',
  password: '',
  contract: '',
  filename: '',
  createDisabled: true,
};


const reducer = function (state = initialState, action) {
  switch (action.type) {
    case CONTRACT_OPEN_MODAL:
      return {
        isOpen: true,
        compileSuccess: false,
        abi: '',
        response: "Status: Upload Contract",
        username: '',
        address: '',
        password: '',
        contract: '',
        filename: '',
        createDisabled: true,
      };
      case CONTRACT_CLOSE_MODAL:
        return {
          ...state,
          isOpen: false
        };
    case ADDRESS_FORM_CHANGE :
      return {
        ...state,
        address: action.address,
        createDisabled: !(state.username && action.address && state.password && state.compileSuccess)
      };
    case USERNAME_FORM_CHANGE:
      return {
        ...state,
        username: action.username,
        createDisabled: !(action.username && state.address && state.password && state.compileSuccess)
      };
    case PASSWORD_FORM_CHANGE:
      return {
        ...state,
        password: action.password,
        createDisabled: !(state.username && state.address && action.password && state.compileSuccess)
      };
    case CONTRACT_FORM_CHANGE:
      return {
        ...state,
        contract: action.contract,
        filename: action.name,
        createDisabled: !(state.username && state.address && state.password && state.compileSuccess)
      };
    case CREATE_CONTRACT:
      return {
        ...state,
        isOpen: true,
        compileSuccess: true,
        response: "Uploading Contract..."
      };
    case CREATE_CONTRACT_FAILURE:
      return {
        ...state,
        isOpen: true,
        compileSuccess: false,
        response: "Error Uploading Contract...: " + action.error,
        error: action.error,
      };
    case CREATE_CONTRACT_SUCCESS:
      return {
        ...state,
        isOpen: false,
        compileSuccess: false,
        response: "Upload Success: " + action.response,
      };
    case COMPILE_CONTRACT:
      return {
        ...state,
        isOpen: true,
        compileSuccess: false,
        response: "Uploading Contract...",
        createDisabled: true
      };
    case COMPILE_CONTRACT_FAILURE:
      return {
        ...state,
        isOpen: true,
        compileSuccess: false,
        response: "Error Uploading Contract...: " + action.error,
        error: action.error,
        createDisabled: true,
      };
    case COMPILE_CONTRACT_SUCCESS:
      return {
        ...state,
        isOpen: true,
        compileSuccess: true,
        abi: action.response,
        createDisabled: !(state.username && state.address && state.password)
      };
    default:
      return state;
  }
};

export default reducer;
