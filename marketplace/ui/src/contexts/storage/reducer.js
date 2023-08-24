import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.resetMessage:
      return {
        ...state,
        success: false,
        message: null
      };
    case actionDescriptors.setMessage:
      return {
        ...state,
        success: action.success,
        message: action.message
      };
    case actionDescriptors.fetchStorage:
      return {
        ...state,
        isStorageLoading: true
      };
    case actionDescriptors.fetchStorageSuccessful:
      return {
        ...state,
        data: action.payload,
        isStorageLoading: false
      };
    case actionDescriptors.fetchStorageFailed:
      return {
        ...state,
        error: action.error,
        isStorageLoading: false
      };
    default:
      throw new Error (`Unhandled action: '${action.type}'`);
  }
}

export default reducer;