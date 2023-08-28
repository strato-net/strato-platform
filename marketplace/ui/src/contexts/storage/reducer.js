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
    case actionDescriptors.fetchAssets:
      return {
        ...state,
        isAssetsLoading: true
      };
    case actionDescriptors.fetchAssetsSuccessful:
      return {
        ...state,
        assets: action.payload,
        isAssetsLoading: false
      };
    case actionDescriptors.fetchAssetsFailed:
      return {
        ...state,
        error: action.error,
        isAssetsLoading: false
      };
    case actionDescriptors.fetchSales:
      return {
        ...state,
        isSalesLoading: true
      };
    case actionDescriptors.fetchSalesSuccessful:
      return {
        ...state,
        sales: action.payload,
        isSalesLoading: false
      };
    case actionDescriptors.fetchSalesFailed:
      return {
        ...state,
        error: action.error,
        isSalesLoading: false
      };
    default:
      throw new Error (`Unhandled action: '${action.type}'`);
  }
}

export default reducer;