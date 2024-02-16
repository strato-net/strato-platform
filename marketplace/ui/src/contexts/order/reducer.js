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
    case actionDescriptors.fetchActivity:
      return {
        ...state,
        isActivitiesLoading: true,
      };
    case actionDescriptors.fetchActivitySuccessful:
      return {
        ...state,
        activities: action.payload,
        isActivitiesLoading: false,
      };
    case actionDescriptors.fetchActivityFailed:
      return {
        ...state,
        error: action.error,
        isActivitiesLoading: false,
      };
    case actionDescriptors.updateOrderStatus:
      return {
        ...state,
      };
    case actionDescriptors.updateOrderStatusSuccessful:
      return {
        ...state,
      };
    case actionDescriptors.updateOrderStatusFailed:
      return {
        ...state,
        error: action.error,
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
    case actionDescriptors.executeSale:
      return {
        ...state,
        isCreateOrderSubmitting: true,
      }
    case actionDescriptors.executeSaleSuccessful:
      return {
        ...state,
        isCreateOrderSubmitting: false,
      }
    case actionDescriptors.executeSaleFailed:
      return {
        ...state,
        error: action.error,
        isCreateOrderSubmitting: false,
      }
    case actionDescriptors.updateOrderComment:
      return {
        ...state,
        isUpdatingOrderComment: true,
      }
    case actionDescriptors.updateOrderCommentSuccessful:
      return {
        ...state,
        isUpdatingOrderComment: false,
      }
    case actionDescriptors.updateOrderCommentFailed:
      return {
        ...state,
        error: action.error,
        isUpdatingOrderComment: false,
      }
    case actionDescriptors.createSaleOrder:
      return {
        ...state,
        isCreateOrderSubmitting: true,
      }
    case actionDescriptors.createSaleOrderSuccessful:
      return {
        ...state,
        isCreateOrderSubmitting: false,
      }
    case actionDescriptors.createSaleOrderFailed:
      return {
        ...state,
        error: action.error,
        isCreateOrderSubmitting: false,
      }
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
