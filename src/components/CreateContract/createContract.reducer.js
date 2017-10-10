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
  CONTRACT_FORM_CHANGE,
  CONTRACT_NAME_CHANGE
} from './createContract.actions';

const initialState = {
  isOpen: false,
  compileSuccess: false,
  abi: undefined,
  response: "Status: Upload Contract",
  username: '',
  contract: '',
  contractName: undefined,
  createDisabled: true,
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
        contract: action.contract
      };
    case CREATE_CONTRACT:
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
    case COMPILE_CONTRACT:
      return {
        ...state,
        isOpen: true,
        response: "Uploading Contract...",
        createDisabled: true
      };
    case COMPILE_CONTRACT_FAILURE:
      return {
        ...state,
        isOpen: true,
        response: "Error Uploading Contract...: " + action.error,
        error: action.error,
        createDisabled: true,
      };
    case COMPILE_CONTRACT_SUCCESS:
    let contracts = action.response && action.response.src && Object.keys(action.response.src);
      return {
        ...state,
        isOpen: true,
        abi: action.response,
        createDisabled: false,
        contractName: contracts && contracts[0]
      };
    default:
      return state;
  }
};

export default reducer;
