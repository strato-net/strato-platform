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
    case actionDescriptors.cancelSale:
      return {
        ...state,
        isorderDetailsLoading: true,
      };
    case actionDescriptors.cancelSaleSuccessful:
      return {
        ...state,
        isorderDetailsLoading: false,
      };
    case actionDescriptors.cancelSaleFailed:
      return {
        ...state,
        isorderDetailsLoading: false,
        error: action.error,
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
        orders: action.payload.orders,
        orderBoughtTotal: action.payload.total,
        isordersLoading: false,
      };
    case actionDescriptors.fetchOrderFailed:
      return {
        ...state,
        error: action.error,
        isordersLoading: false,
      };
    case actionDescriptors.fetchAllOrders:
      return {
        ...state,
        isAllOrdersLoading: true,
      };
    case actionDescriptors.fetchAllOrdersSuccessful:
      return {
        ...state,
        allOrders: action.payload,
        isAllOrdersLoading: false,
      };
    case actionDescriptors.fetchAllOrdersFailed:
      return {
        ...state,
        error: action.error,
        isAllOrdersLoading: false,
      };
    case actionDescriptors.fetchSaleQuantity:
      return {
        ...state,
        saleQuantityLoading: true,
      };
    case actionDescriptors.fetchSaleQuantitySuccessful:
      return {
        ...state,
        saleQuantity: action.payload,
        saleQuantityLoading: false,
      };
    case actionDescriptors.fetchSaleQuantityFailed:
      return {
        ...state,
        error: action.error,
        saleQuantityLoading: false,
      };
    case actionDescriptors.fetchOrderSold:
      return {
        ...state,
        isordersSoldLoading: true,
      };
    case actionDescriptors.fetchOrderSoldSuccessful:
      return {
        ...state,
        ordersSold: action.payload.orders,
        orderSoldTotal: action.payload.total,
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
    case actionDescriptors.executeSale:
      return {
        ...state,
        isCreateOrderSubmitting: true,
      };
    case actionDescriptors.executeSaleSuccessful:
      return {
        ...state,
        isCreateOrderSubmitting: false,
      };
    case actionDescriptors.executeSaleFailed:
      return {
        ...state,
        error: action.error,
        isCreateOrderSubmitting: false,
      };
    case actionDescriptors.waitForOrderEvent:
      return {
        ...state,
        isOrderEventLoading: true,
      };
    case actionDescriptors.waitForOrderEventSuccessful:
      return {
        ...state,
        isOrderEventLoading: false,
      };
    case actionDescriptors.waitForOrderEventFailed:
      return {
        ...state,
        error: action.error,
        isOrderEventLoading: false,
      };
    case actionDescriptors.updateOrderComment:
      return {
        ...state,
        isUpdatingOrderComment: true,
      };
    case actionDescriptors.updateOrderCommentSuccessful:
      return {
        ...state,
        isUpdatingOrderComment: false,
      };
    case actionDescriptors.updateOrderCommentFailed:
      return {
        ...state,
        error: action.error,
        isUpdatingOrderComment: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
