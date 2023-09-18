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
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
