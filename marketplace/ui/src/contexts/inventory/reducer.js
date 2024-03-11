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
    case actionDescriptors.createInventory:
      return {
        ...state,
        isCreateInventorySubmitting: true
      };
    case actionDescriptors.createInventorySuccessful:
      return {
        ...state,
        inventory: action.payload,
        isCreateInventorySubmitting: false
      };
    case actionDescriptors.createInventoryFailed:
      return {
        ...state,
        error: action.error,
        isCreateInventorySubmitting: false
      };
    case actionDescriptors.fetchInventory:
      return {
        ...state,
        isInventoriesLoading: true
      };
    case actionDescriptors.fetchInventorySuccessful:
      return {
        ...state,
        inventories: action.payload.data,
        inventoriesTotal: action.payload.count,
        isInventoriesLoading: false
      };
    case actionDescriptors.fetchInventoryFailed:
      return {
        ...state,
        error: action.error,
        isInventoriesLoading: false
      };
      case actionDescriptors.fetchInventoryForUser:
        return {
          ...state,
          isUserInventoriesLoading: true
        };
      case actionDescriptors.fetchInventoryForUserSuccessful:
        return {
          ...state,
          userInventories: action.payload.data,
          userInventoriesTotal: action.payload.count,
          isUserInventoriesLoading: false
        };
      case actionDescriptors.fetchInventoryForUserFailed:
        return {
          ...state,
          error: action.error,
          isUserInventoriesLoading: false
        };
    case actionDescriptors.fetchInventorySearch:
      return {
        ...state,
        isInventoriesLoading: true
      };
    case actionDescriptors.fetchInventorySearchSuccessful:
      return {
        ...state,
        inventories: action.payload.data,
        inventoriesTotal: action.payload.count,
        isInventoriesLoading: false
      };
    case actionDescriptors.fetchInventorySearchFailed:
      return {
        ...state,
        error: action.error,
        isInventoriesLoading: false
      };
    case actionDescriptors.updateInventory:
      return {
        ...state,
        isinventoryUpdating: true
      };
    case actionDescriptors.updateInventorySuccessful:
      return {
        ...state,
        inventoryUpdateObject: action.payload,
        isinventoryUpdating: false
      };
    case actionDescriptors.updateInventoryFailed:
      return {
        ...state,
        error: action.error,
        isinventoryUpdating: false
      };
    case actionDescriptors.updateSale:
      return {
        ...state,
        issaleUpdating: true
      };
    case actionDescriptors.updateSaleSuccessful:
      return {
        ...state,
        saleUpdateObject: action.payload,
        issaleUpdating: false
      };
    case actionDescriptors.updateSaleFailed:
      return {
        ...state,
        error: action.error,
        issaleUpdating: false
      };
    case actionDescriptors.listInventory:
      return {
        ...state,
        isListing: true
      };
    case actionDescriptors.listInventorySuccessful:
      return {
        ...state,
        inventory: action.payload,
        isListing: false
      };
    case actionDescriptors.listInventoryFailed:
      return {
        ...state,
        error: action.error,
        isListing: false
      };
    case actionDescriptors.unlistInventory:
      return {
        ...state,
        isUnlisting: true
      };
    case actionDescriptors.unlistInventorySuccessful:
      return {
        ...state,
        inventory: action.payload,
        isUnlisting: false
      };
    case actionDescriptors.unlistInventoryFailed:
      return {
        ...state,
        error: action.error,
        isUnlisting: false
      };
    case actionDescriptors.resellInventory:
      return {
        ...state,
        isReselling: true
      };
    case actionDescriptors.resellInventorySuccessful:
      return {
        ...state,
        inventory: action.payload,
        isReselling: false
      };
    case actionDescriptors.resellInventoryFailed:
      return {
        ...state,
        error: action.error,
        isReselling: false
      };
    case actionDescriptors.transferInventory:
      return {
        ...state,
        isTransferring: true
      };
    case actionDescriptors.transferInventorySuccessful:
      return {
        ...state,
        inventory: action.payload,
        isTransferring: false
      };
    case actionDescriptors.transferInventoryFailed:
      return {
        ...state,
        error: action.error,
        isTransferring: false
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
    case actionDescriptors.fetchInventoryOwnershipHistory:
      return {
        ...state,
        isInventoryOwnershipHistoryLoading: true
      };
    case actionDescriptors.fetchInventoryOwnershipHistorySuccessful:
      return {
        ...state,
        inventoryOwnershipHistory: action.payload,
        isInventoryOwnershipHistoryLoading: false
      };
    case actionDescriptors.fetchInventoryOwnershipHistoryFailed:
      return {
        ...state,
        error: action.error,
        isInventoryOwnershipHistoryLoading: false
      };
    case actionDescriptors.fetchInventoryDetail:
      return {
        ...state,
        isInventoryDetailsLoading: true
      };
    case actionDescriptors.fetchInventoryDetailSuccessful:
      return {
        ...state,
        inventoryDetails: action.payload,
        isInventoryDetailsLoading: false
      };
    case actionDescriptors.fetchInventoryDetailFailed:
      return {
        ...state,
        error: action.error,
        isInventoryDetailsLoading: false
      };
    case actionDescriptors.onboardSellerToMetamask:
      return {
        ...state,
        isOnboardingSellerToMetamask: true
      };
    case actionDescriptors.onboardSellerToMetamaskSuccessful:
      return {
        ...state,
        metamaskStatus: true,
        isOnboardingSellerToMetamask: false
      };
    case actionDescriptors.onboardSellerToMetamaskFailed:
      return {
        ...state,
        error: action.error,
        isOnboardingSellerToMetamask: false
      };
    case actionDescriptors.sellerMetamaskStatus:
      return {
        ...state,
        isLoadingMetamaskStatus: true
      };
    case actionDescriptors.sellerMetamaskStatusSuccessful:
      return {
        ...state,
        metamaskStatus: true,
        isLoadingMetamaskStatus: false
      };
    case actionDescriptors.sellerMetamaskStatusFailed:
      return {
        ...state,
        error: action.error,
        isLoadingMetamaskStatus: false
      };
    case actionDescriptors.onboardSellerToStripe:
      return {
        ...state,
        isOnboardingSellerToStripe: true
      };
    case actionDescriptors.onboardSellerToStripeSuccessful:
      return {
        ...state,
        onboardedSeller: action.payload,
        isOnboardingSellerToStripe: false
      };
    case actionDescriptors.onboardSellerToStripeFailed:
      return {
        ...state,
        error: action.error,
        isOnboardingSellerToStripe: false
      };
    case actionDescriptors.sellerStripeStatus:
      return {
        ...state,
        isLoadingStripeStatus: true
      };
    case actionDescriptors.sellerStripeStatusSuccessful:
      return {
        ...state,
        stripeStatus: action.payload,
        isLoadingStripeStatus: false
      };
    case actionDescriptors.sellerStripeStatusFailed:
      return {
        ...state,
        error: action.error,
        isLoadingStripeStatus: false
      };
    case actionDescriptors.uploadImage:
      return {
        ...state,
        isUploadImageSubmitting: true,
      };
    case actionDescriptors.uploadImageSuccessful:
      return {
        ...state,
        uploadedImg: action.payload,
        isUploadImageSubmitting: false,
      };
    case actionDescriptors.uploadImageFailed:
      return {
        ...state,
        error: action.error,
        isUploadImageSubmitting: false,
      };
    case actionDescriptors.createItem:
      return {
        ...state,
        isCreateInventorySubmitting: true,
      }
    case actionDescriptors.createItemSuccessful:
      return {
        ...state,
        isCreateInventorySubmitting: false,
      }
    case actionDescriptors.createItemFailed:
      return {
        ...state,
        error: action.error,
        isCreateInventorySubmitting: false,
      }
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
