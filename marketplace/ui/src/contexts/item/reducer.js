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
    case actionDescriptors.fetchItem:
      return {
        ...state,
        isItemsLoading: true
      };
    case actionDescriptors.fetchItemSuccessful:
      return {
        ...state,
        items: action.payload,
        isItemsLoading: false
      };
    case actionDescriptors.fetchItemFailed:
      return {
        ...state,
        error: action.error,
        isItemsLoading: false
      };
      case actionDescriptors.fetchSerialNumbers:
        return {
          ...state,
          isSerialNumbersLoading: true,
        };
      case actionDescriptors.fetchSerialNumbersSuccessful:
        return {
          ...state,
          serialNumbers: action.payload,
          isSerialNumbersLoading: false,
        };
      case actionDescriptors.fetchSerialNumbersFailed:
        return {
          ...state,
          error: action.error,
          isSerialNumbersLoading: false,
        };
      case actionDescriptors.fetchItemRawMaterials:
        return {
          ...state,
          isRawMaterialsLoading: true,
        };
      case actionDescriptors.fetchItemRawMaterialsSuccessful:
        return {
          ...state,
          rawMaterials: action.payload,
          isRawMaterialsLoading: false,
        };
      case actionDescriptors.fetchItemRawMaterialsFailed:
        return {
          ...state,
          error: action.error,
          isRawMaterialsLoading: false,
        };
      case actionDescriptors.setActualRawMaterials:
        return {
          ...state,
          actualRawMaterials: action.payload
        };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
