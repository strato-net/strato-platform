import {
  DEPLOY_DAPP_OPEN_MODAL,
  DEPLOY_DAPP_CLOSE_MODAL,
  DEPLOY_DAPP_REQUEST,
  DEPLOY_DAPP_SUCCESS,
  DEPLOY_DAPP_FAILURE,
  // OPEN_ADD_MEMBER_MODAL,
  // CLOSE_ADD_MEMBER_MODAL,
  // OPEN_ADD_INTEGRATION_MODAL,
  // CLOSE_ADD_INTEGRATION_MODAL,
  // COMPILE_CONTRACT_REQUEST,
  // COMPILE_CONTRACT_FAILURE,
  // COMPILE_CONTRACT_SUCCESS,
  USERNAME_FORM_CHANGE,
  CONTRACT_FORM_CHANGE,
  CHAIN_NAME_CHANGE,
  UPDATE_TOAST,
  RESET_ERROR
} from './deployDapp.actions';

const initialState = {
  isAddMemberModalOpen: false,
  isAddIntegrationModalOpen: false,
  isOpen: false,
  contractCompileErrors: undefined,
  abi: undefined,
  response: "Status: Deploy DApp",
  contract: '',
  chainName: '',
  createDisabled: true,
  filename: undefined,
  isToasts: false,
  toastsMessage: '',
  error: ''
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case DEPLOY_DAPP_OPEN_MODAL:
      return {
        isOpen: true,
        abi: '',
        response: "Status: Deploy DApp",
        contract: '',
        chainName: '',
        createDisabled: true,
        filename: '',
        members: [],
        integrations: [],
        // createDisabled: true,
      };

    case USERNAME_FORM_CHANGE:
      return {
        ...state,
        username: action.name
      };

    case DEPLOY_DAPP_CLOSE_MODAL:
      return {
        ...state,
        isOpen: false
      };

    case CHAIN_NAME_CHANGE:
      return {
        ...state,
        chainName: action.chainName
      };

    case CONTRACT_FORM_CHANGE:
      return {
        ...state,
        contract: action.contract,
        filename: action.name,
        contractCompileErrors: undefined,
      };
    case DEPLOY_DAPP_REQUEST:
      return {
        ...state,
        isOpen: true,
        response: "Deploying DApp..."
      };
    case DEPLOY_DAPP_FAILURE:
      return {
        ...state,
        isOpen: true,
        response: "Error Deploying DApp...: " + action.error,
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
    case DEPLOY_DAPP_SUCCESS:
      return {
        ...state,
        isOpen: false,
        response: "Deployment Success: " + action.response,
        isToasts: action.toasts,
        toastsMessage: action.response && action.response.status ? 'DApp Deployed' : action.response
      };
    case RESET_ERROR:
      return {
        ...state,
        isToasts: null,
        toastsMessage: null
      }
    default:
      return state;
  }
};

export default reducer;
