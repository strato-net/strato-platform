import { actionDescriptors } from './actions';

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.resetMessage:
      return {
        ...state,
        success: false,
        message: null,
      };
    case actionDescriptors.setMessage:
      return {
        ...state,
        success: action.success,
        message: action.message,
      };
    
    case actionDescriptors.fetchBridgeableTokens:
      return {
        ...state,
      };
    case actionDescriptors.fetchBridgeableTokensSuccessful:
      return {
        ...state,
        bridgeableTokens: action.payload,
      };
    case actionDescriptors.fetchBridgeableTokensFailed:
      return {
        ...state,
      };
      
    case actionDescriptors.addHash:
      return {
        ...state,
        isAddingHash: true,
      };
    case actionDescriptors.addHashSuccessful:
      return {
        ...state,
        isAddingHash: false,
      };
    case actionDescriptors.addHashFailed:
      return {
        ...state,
        isAddingHash: false,
      };
    case actionDescriptors.bridgeOut:
      return {
        ...state,
        isBridgingOut: true,
      };
    case actionDescriptors.bridgeOutSuccessful:
      return {
        ...state,
        isBridgingOut: false,
      };
    case actionDescriptors.bridgeOutFailed:
      return {
        ...state,
        isBridgingOut: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
