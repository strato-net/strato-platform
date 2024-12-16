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
    case actionDescriptors.fetchETHSTAddress:
      return {
        ...state,
      };
    case actionDescriptors.fetchETHSTAddressSuccessful:
      return {
        ...state,
        ethstAddress: action.payload,
      };
    case actionDescriptors.fetchETHSTAddressFailed:
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
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
