import { actionDescriptors } from "./actions";

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
    case actionDescriptors.createOrder:
      return {
        ...state,
        isCreateOrderSubmitting: true,
      };
    case actionDescriptors.createOrderSuccessful:
      return {
        ...state,
        order: action.payload,
        isCreateOrderSubmitting: false,
      };
    case actionDescriptors.createOrderFailed:
      return {
        ...state,
        error: action.error,
        isCreateOrderSubmitting: false,
      };
    case actionDescriptors.createPayment:
      return {
        ...state,
        isCreatePaymentSubmitting: true,
      };
    case actionDescriptors.createPaymentSuccessful:
      return {
        ...state,
        payment: action.payload,
        isCreatePaymentSubmitting: false,
      };
    case actionDescriptors.createPaymentFailed:
      return {
        ...state,
        error: action.error,
        isCreatePaymentSubmitting: false,
      };
    case actionDescriptors.createOrderLineItem:
      return {
        ...state,
        isCreateOrderLineItem: true,
      };
    case actionDescriptors.createOrderLineItemSuccessful:
      return {
        ...state,
        item: action.payload,
        isCreateOrderLineItem: false,
      };
    case actionDescriptors.createOrderLineItemFailed:
      return {
        ...state,
        error: action.error,
        isCreateOrderLineItem: false,
      };
    case actionDescriptors.fetchOrder:
      return {
        ...state,
        isordersLoading: true,
      };
    case actionDescriptors.fetchOrderSuccessful:
      return {
        ...state,
        orders: action.payload,
        isordersLoading: false,
      };
    case actionDescriptors.fetchOrderFailed:
      return {
        ...state,
        error: action.error,
        isordersLoading: false,
      };
    case actionDescriptors.fetchOrderSold:
      return {
        ...state,
        isordersSoldLoading: true,
      };
    case actionDescriptors.fetchOrderSoldSuccessful:
      return {
        ...state,
        ordersSold: action.payload,
        isordersSoldLoading: false,
      };
    case actionDescriptors.fetchOrderSoldFailed:
      return {
        ...state,
        error: action.error,
        isordersSoldLoading: false,
      };
    case actionDescriptors.fetchOrderDetails:
      return {
        ...state,
        isorderDetailsLoading: true,
      };
    case actionDescriptors.fetchOrderDetailsSuccessful:
      return {
        ...state,
        orderDetails: action.payload,
        isorderDetailsLoading: false,
      };
    case actionDescriptors.fetchOrderDetailsFailed:
      return {
        ...state,
        error: action.error,
        isorderDetailsLoading: false,
      };
    case actionDescriptors.fetchOrderLineItemDetails:
      return {
        ...state,
        isOrderLineDetailsLoading: true,
      };
    case actionDescriptors.fetchOrderLineItemDetailsSuccessful:
      return {
        ...state,
        orderLineDetails: action.payload,
        isOrderLineDetailsLoading: false,
      };
    case actionDescriptors.fetchOrderLineItemDetailsFailed:
      return {
        ...state,
        error: action.error,
        isOrderLineDetailsLoading: false,
      };
    case actionDescriptors.transferOrderOwnership:
      return {
        ...state,
        isOwnershiporderTransferring: true,
      };
    case actionDescriptors.transferOrderOwnershipSuccessful:
      return {
        ...state,
        orderOwnership: action.payload,
        isOwnershiporderTransferring: false,
      };
    case actionDescriptors.transferOrderOwnershipFailed:
      return {
        ...state,
        error: action.error,
        isOwnershiporderTransferring: false,
      };
    case actionDescriptors.updateOrder:
      return {
        ...state,
        isorderUpdating: true,
      };
    case actionDescriptors.updateOrderSuccessful:
      return {
        ...state,
        orderUpdateObject: action.payload,
        isorderUpdating: false,
      };
    case actionDescriptors.updateOrderFailed:
      return {
        ...state,
        error: action.error,
        isorderUpdating: false,
      };
    case actionDescriptors.updateBuyerDetails:
      return {
        ...state,
        isbuyerDetailsUpdating: true,
      };
    case actionDescriptors.updateBuyerDetailsSuccessful:
      return {
        ...state,
        buyerUpdateObject: action.payload,
        isbuyerDetailsUpdating: false,
      };
    case actionDescriptors.updateBuyerDetailsFailed:
      return {
        ...state,
        error: action.error,
        isbuyerDetailsUpdating: false,
      };
    case actionDescriptors.updateSellerDetails:
      return {
        ...state,
        issellerDetailsUpdating: true,
      };
    case actionDescriptors.updateSellerDetailsSuccessful:
      return {
        ...state,
        sellerUpdateObject: action.payload,
        issellerDetailsUpdating: false,
      };
    case actionDescriptors.updateSellerDetailsFailed:
      return {
        ...state,
        error: action.error,
        issellerDetailsUpdating: false,
      };
    case actionDescriptors.fetchOrderAudit:
      return {
        ...state,
        isordersAuditLoading: true,
      };
    case actionDescriptors.fetchOrderAuditSuccessful:
      return {
        ...state,
        ordersAudit: action.payload,
        isordersAuditLoading: false,
      };
    case actionDescriptors.fetchOrderAuditFailed:
      return {
        ...state,
        error: action.error,
        isordersAuditLoading: false,
      };
    case actionDescriptors.importAssetRequest:
      return {
        ...state,
        isAssetImportInProgress: true,
        assetsUploaded: 0,
        assetsUploadedErrors: [],
      };
    case actionDescriptors.importAssetSuccess:
      return {
        ...state,
        isAssetImportInProgress: false,
        error: null,
      };
    case actionDescriptors.importAssetFailure:
      return {
        ...state,
        error: action.error,
        isAssetImportInProgress: false,
        isImportAssetsModalOpen: true,
      };
    case actionDescriptors.updateAssetImportCount:
      return {
        ...state,
        assetsUploaded: action.count,
      };
    case actionDescriptors.updateAssetUploadError:
      return {
        ...state,
        assetsUploadedErrors: action.errors,
      };
    case actionDescriptors.openImportCSVModal:
      return {
        ...state,
        isImportAssetsModalOpen: true,
      };
    case actionDescriptors.closeImportCSVModal:
      return {
        ...state,
        isImportAssetsModalOpen: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
