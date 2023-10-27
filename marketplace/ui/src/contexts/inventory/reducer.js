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
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
