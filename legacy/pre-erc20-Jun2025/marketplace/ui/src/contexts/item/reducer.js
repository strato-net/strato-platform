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
    case actionDescriptors.fetchItem:
      return {
        ...state,
        isItemsLoading: true,
      };
    case actionDescriptors.fetchItemSuccessful:
      return {
        ...state,
        items: action.payload,
        isItemsLoading: false,
      };
    case actionDescriptors.fetchItemFailed:
      return {
        ...state,
        error: action.error,
        isItemsLoading: false,
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
    case actionDescriptors.fetchItemOwnershipHistory:
      return {
        ...state,
        isOwnershipHistoryLoading: true,
      };
    case actionDescriptors.fetchItemOwnershipHistorySuccessful:
      return {
        ...state,
        ownershipHistory: action.payload,
        isOwnershipHistoryLoading: false,
      };
    case actionDescriptors.fetchItemOwnershipHistoryFailed:
      return {
        ...state,
        error: action.error,
        isOwnershipHistoryLoading: false,
      };
    case actionDescriptors.fetchItemTransfers:
      return {
        ...state,
        isFetchingItemTransfers: true,
      };
    case actionDescriptors.fetchItemTransfersSuccessful:
      return {
        ...state,
        itemTransfers: action.payload.transfers,
        totalItemsTransfered: action.payload.total,
        isFetchingItemTransfers: false,
      };
    case actionDescriptors.fetchItemTransfersFailed:
      return {
        ...state,
        error: action.error,
        isFetchingItemTransfers: false,
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
        actualRawMaterials: action.payload,
      };
    case actionDescriptors.transferOwnership:
      return {
        ...state,
        isTransferringItems: true,
      };
    case actionDescriptors.transferOwnershipSuccessful:
      return {
        ...state,
        isTransferringItems: false,
      };
    case actionDescriptors.transferOwnershipFailed:
      return {
        ...state,
        error: action.error,
        isTransferringItems: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
