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
    case actionDescriptors.createItem:
      return {
        ...state,
        isCreateItemSubmitting: true
      };
    case actionDescriptors.createItemSuccessful:
      return {
        ...state,
        item: action.payload,
        isCreateItemSubmitting: false
      };
    case actionDescriptors.createItemFailed:
      return {
        ...state,
        error: action.error,
        isCreateItemSubmitting: false
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
    case actionDescriptors.fetchItemDetails:
      return {
        ...state,
        isitemDetailsLoading: true
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
    case actionDescriptors.fetchItemDetailsSuccessful:
      return {
        ...state,
        itemDetails: action.payload,
        isitemDetailsLoading: false
      };
    case actionDescriptors.fetchItemDetailsFailed:
      return {
        ...state,
        error: action.error,
        isitemDetailsLoading: false
      };
    case actionDescriptors.transferItemOwnership:
      return {
        ...state,
        isOwnershipitemTransferring: true
      };
    case actionDescriptors.transferItemOwnershipSuccessful:
      return {
        ...state,
        itemOwnership: action.payload,
        isOwnershipitemTransferring: false
      };
    case actionDescriptors.transferItemOwnershipFailed:
      return {
        ...state,
        error: action.error,
        isOwnershipitemTransferring: false
      };
    case actionDescriptors.updateItem:
      return {
        ...state,
        isitemUpdating: true
      };
    case actionDescriptors.updateItemSuccessful:
      return {
        ...state,
        itemUpdateObject: action.payload,
        isitemUpdating: false
      };
    case actionDescriptors.updateItemFailed:
      return {
        ...state,
        error: action.error,
        isitemUpdating: false
      };
    case actionDescriptors.fetchItemAudit:
      return {
        ...state,
        isitemsAuditLoading: true
      };
    case actionDescriptors.fetchItemAuditSuccessful:
      return {
        ...state,
        itemsAudit: action.payload,
        isitemsAuditLoading: false
      };
    case actionDescriptors.fetchItemAuditFailed:
      return {
        ...state,
        error: action.error,
        isitemsAuditLoading: false
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
