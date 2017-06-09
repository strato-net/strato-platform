import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY,
  CREATE_CONTRACT,
  CREATE_CONTRACT_SUCCESS,
  CREATE_CONTRACT_FAILURE,
  COMPILE_CONTRACT,
  COMPILE_CONTRACT_FAILURE,
  COMPILE_CONTRACT_SUCCESS,
  USERNAME_FORM_CHANGE,
  PASSWORD_FORM_CHANGE,
  CONTRACT_FORM_CHANGE,
} from './createContract.actions';

const initialState = {
  isOpen: false,
  compileSuccess: false,
  abi: '',
  response: "Status: Upload Contract",
  username: '',
  password: '',
  contract: '',
  filename: 'Upload a Smart Contract(.sol)',
  createDisabled: true,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case USERNAME_FORM_CHANGE:
      return {
        isOpen: state.isOpen,
        compileSuccess: false,
        username: action.username,
        password: state.password,
        contract: state.contract,
        filename: state.filename,
        createDisabled: true,
      };
    case PASSWORD_FORM_CHANGE:
      return {
        isOpen: state.isOpen,
        compileSuccess: false,
        username: state.username,
        password: action.password,
        contract: state.contract,
        filename: state.filename,
        createDisabled: true,
      };
    case CONTRACT_FORM_CHANGE:
      return {
        isOpen: state.isOpen,
        compileSuccess: false,
        username: state.username,
        password: state.password,
        contract: action.contract,
        filename: action.name,
        createDisabled: true,
      };
    case OPEN_OVERLAY:
      return {
        isOpen: true,
        createDisabled: true,
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
        response: "Uploading Contract...",
        username: state.username,
        password: state.password,
        contract: state.contract,
        filename: state.filename,
        createDisabled: true,
      };
    case COMPILE_CONTRACT_FAILURE:
      return {
        isOpen: true,
        compileSuccess: false,
        response: "Error Uploading Contract...: " + action.error,
        error: action.error,
        createDisabled: true,
      };
    case COMPILE_CONTRACT_SUCCESS:
      return {
        isOpen: true,
        compileSuccess: true,
        abi: action.response,
        username: state.username,
        password: state.password,
        contract: state.contract,
        filename: state.filename,
        createDisabled: false,
      };
    default:
      return state;
  }
};

export default reducer;