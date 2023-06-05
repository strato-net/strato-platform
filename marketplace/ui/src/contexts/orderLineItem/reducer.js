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
    case actionDescriptors.createOrderLineItem:
      return {
        ...state,
        isCreateOrderLineItemSubmitting: true
      };
    case actionDescriptors.createOrderLineItemSuccessful:
      return {
        ...state,
        orderLineItem: action.payload,
        isCreateOrderLineItemSubmitting: false
      };
    case actionDescriptors.createOrderLineItemFailed:
      return {
        ...state,
        error: action.error,
        isCreateOrderLineItemSubmitting: false
      };
    case actionDescriptors.fetchOrderLineItem:
      return {
        ...state,
        isOrderLineItemsLoading: true
      };
    case actionDescriptors.fetchOrderLineItemSuccessful:
      return {
        ...state,
        orderLineItems: action.payload,
        isOrderLineItemsLoading: false
      };
    case actionDescriptors.fetchOrderLineItemFailed:
      return {
        ...state,
        error: action.error,
        isOrderLineItemsLoading: false
      };
    case actionDescriptors.fetchOrderLineItemDetails:
      return {
        ...state,
        isorderLineItemDetailsLoading: true
      };
    case actionDescriptors.fetchOrderLineItemDetailsSuccessful:
      return {
        ...state,
        orderLineItemDetails: action.payload,
        isorderLineItemDetailsLoading: false
      };
    case actionDescriptors.fetchOrderLineItemDetailsFailed:
      return {
        ...state,
        error: action.error,
        isorderLineItemDetailsLoading: false
      };
    case actionDescriptors.transferOrderLineItemOwnership:
      return {
        ...state,
        isOwnershiporderLineItemTransferring: true
      };
    case actionDescriptors.transferOrderLineItemOwnershipSuccessful:
      return {
        ...state,
        orderLineItemOwnership: action.payload,
        isOwnershiporderLineItemTransferring: false
      };
    case actionDescriptors.transferOrderLineItemOwnershipFailed:
      return {
        ...state,
        error: action.error,
        isOwnershiporderLineItemTransferring: false
      };
    case actionDescriptors.updateOrderLineItem:
      return {
        ...state,
        isorderLineItemUpdating: true
      };
    case actionDescriptors.updateOrderLineItemSuccessful:
      return {
        ...state,
        orderLineItemUpdateObject: action.payload,
        isorderLineItemUpdating: false
      };
    case actionDescriptors.updateOrderLineItemFailed:
      return {
        ...state,
        error: action.error,
        isorderLineItemUpdating: false
      };
    case actionDescriptors.fetchOrderLineItemAudit:
      return {
        ...state,
        isorderLineItemsAuditLoading: true
      };
    case actionDescriptors.fetchOrderLineItemAuditSuccessful:
      return {
        ...state,
        orderLineItemsAudit: action.payload,
        isorderLineItemsAuditLoading: false
      };
    case actionDescriptors.fetchOrderLineItemAuditFailed:
      return {
        ...state,
        error: action.error,
        isorderLineItemsAuditLoading: false
      };
    case actionDescriptors.importAssetRequest:
      return {
        ...state,
        isAssetImportInProgress: true,
        assetsUploaded: 0,
        assetsUploadedErrors: []
      }
    case actionDescriptors.importAssetSuccess:
      return {
        ...state,
        isAssetImportInProgress: false,
        error: null
      }
    case actionDescriptors.importAssetFailure:
      return {
        ...state,
        error: action.error,
        isAssetImportInProgress: false,
        isImportAssetsModalOpen: true
      }
    case actionDescriptors.updateAssetImportCount:
      return {
        ...state,
        assetsUploaded: action.count
      }
    case actionDescriptors.updateAssetUploadError:
      return {
        ...state,
        assetsUploadedErrors: action.errors
      }
    case actionDescriptors.openImportCSVModal:
      return {
        ...state,
        isImportAssetsModalOpen: true
      }
    case actionDescriptors.closeImportCSVModal:
      return {
        ...state,
        isImportAssetsModalOpen: false
      }
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
