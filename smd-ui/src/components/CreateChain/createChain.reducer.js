import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY,
  CREATE_CHAIN_REQUEST,
  CREATE_CHAIN_FAILURE,
  CREATE_CHAIN_SUCCESS,
  OPEN_ADD_MEMBER_MODAL,
  CLOSE_ADD_MEMBER_MODAL,
  OPEN_ADD_INTEGRATION_MODAL,
  CLOSE_ADD_INTEGRATION_MODAL,
  RESET_ERROR,
  COMPILE_CHAIN_CONTRACT_SUCCESS,
  COMPILE_CHAIN_CONTRACT_FAILURE,
  RESET_CONTRACT,
  CONTRACT_NAME_CHANGE,
} from './createChain.actions';

const initialState = {
  isAddMemberModalOpen: false,
  isAddIntegrationModalOpen: false,
  isOpen: false,
  spinning: false,
  key: null,
  error: null,
  abi: null,
  contractName: undefined
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
    case OPEN_ADD_MEMBER_MODAL:
      return {
        ...state,
        isAddMemberModalOpen: true,
      };
    case CLOSE_ADD_MEMBER_MODAL:
      return {
        ...state,
        isAddMemberModalOpen: false
      };
    case OPEN_ADD_INTEGRATION_MODAL:
      return {
        ...state,
        isAddIntegrationModalOpen: true,
      };
    case CLOSE_ADD_INTEGRATION_MODAL:
      return {
        ...state,
        isAddIntegrationModalOpen: false
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
    case RESET_ERROR:
      return {
        ...state,
        error: null
      };
    case COMPILE_CHAIN_CONTRACT_SUCCESS:
      let contracts = action.response && action.response.src && Object.keys(action.response.src);
      return {
        ...state,
        abi: action.response,
        contractName: contracts && contracts[0]
      }
    case COMPILE_CHAIN_CONTRACT_FAILURE:
      return {
        ...state,
        error: action.error
      }
    case RESET_CONTRACT:
      return {
        ...state,
        abi: null
      }
    case CONTRACT_NAME_CHANGE:
      return {
        ...state,
        contractName: action.contractName
      };
    default:
      return state;
  }
};

export default reducer;