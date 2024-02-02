import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createOrder: "create_order",
  createOrderSuccessful: "create_order_successful",
  createOrderFailed: "create_order_failed",
  createPayment: "create_payment",
  createPaymentSuccessful: "create_payment_successful",
  createPaymentFailed: "create_payment_failed",
  createOrderLineItem: "create_order_line_item",
  createOrderLineItemSuccessful: "create_order_line_item_successful",
  createOrderLineItemFailed: "create_order_line_item_failed",
  fetchOrder: "fetch_orders",
  fetchOrderSuccessful: "fetch_order_successful",
  fetchOrderFailed: "fetch_order_failed",
  fetchOrderSold: "fetch_orders_sold",
  fetchOrderSoldSuccessful: "fetch_order_sold_successful",
  fetchOrderSoldFailed: "fetch_order_sold_failed",
  fetchAllOrders: "fetch_all_orders",
  fetchAllOrdersSuccessful: "fetch_all_orders_successful",
  fetchAllOrdersFailed: "fetch_all_orders_failed",
  fetchOrderDetails: "fetch_order_details",
  fetchOrderDetailsSuccessful: "fetch_order_details_successful",
  fetchOrderDetailsFailed: "fetch_order_details_failed",
  fetchOrderLineItemDetails: "fetch_order_line_item_details",
  fetchOrderLineItemDetailsSuccessful: "fetch_order_line_item_details_successful",
  fetchOrderLineItemDetailsFailed: "fetch_order_line_item_details_failed",
  updateBuyerDetails: "update_buyer_details",
  updateBuyerDetailsSuccessful: "update_buyer_details_successful",
  updateBuyerDetailsFailed: "update_buyer_details_failed",
  updateSellerDetails: "update_seller_details",
  updateSellerDetailsSuccessful: "update_seller_details_successful",
  updateSellerDetailsFailed: "update_seller_details_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  updateOrderStatus: "update_order_status",
  updateOrderStatusSuccessful: "update_order_status_successful",
  updateOrderStatusFailed: "update_order_status_failed",
  createSaleOrder: "create_sale",
  createSaleOrderSuccessful: "create_sale_successful",
  createSaleOrderFailed: "create_sale_failed",
  cancelSale: "cancel_sale",
  cancelSaleSuccessful: "cancel_sale_successful",
  cancelSaleFailed: "cancel_sale_failed",
  executeSale: "execute_sale",
  executeSaleSuccessful: "execute_sale_successful",
  executeSaleFailed: "execute_sale_failed",
  updateOrderComment: "update_order_comment",
  updateOrderCommentSuccessful: "update_order_comment_successful",
  updateOrderCommentFailed: "update_order_comment_failed",
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  createOrder: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createOrder });

    try {
      const response = await fetch(`${apiUrl}/order`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createOrderSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Order created successfully", true);
        return true;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createOrderFailed,
          error: "Unauthorized while creating Order"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.createOrderFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createOrderFailed,
        error: "Error while creating Order",
      });
      actions.setMessage(dispatch, "Error while creating Order");
    }
  },

  createPayment: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createPayment });

    try {
      const response = await fetch(`${apiUrl}/order/payment`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createPaymentSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Payment created successfully", true);
        return body.data;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createPaymentFailed,
          error: "Unauthorized while creating Order"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.createPaymentFailed,
        error: "Error while creating Order",
      });
      actions.setMessage(dispatch, "Error while creating Order");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createPaymentFailed,
        error: "Error while creating Order",
      });
      actions.setMessage(dispatch, "Error while creating Order");
    }
  },

  createOrderLineItem: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createOrderLineItem });

    try {
      const response = await fetch(`${apiUrl}/orderLineItem`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createOrderLineItemSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Item created successfully", true);
        return true;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createOrderLineItemFailed,
          error: "Unauthorized while creating Item"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.createOrderLineItemFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createOrderLineItemFailed,
        error: "Error while creating Item",
      });
      actions.setMessage(dispatch, "Error while creating Item");
    }
  },

  fetchOrderDetails: async (dispatch, id) => {
    dispatch({ type: actionDescriptors.fetchOrderDetails });

    try {
      const response = await fetch(`${apiUrl}/order/${id}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchOrderDetailsSuccessful,
          payload: body.data,
        });

        return body.data;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchOrderDetailsFailed,
          error: "Unauthorized while fetching Order"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.fetchOrderDetailsFailed,
        error: body.error,
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchOrderDetailsFailed,
        error: "Error while fetching Order",
      });
    }
  },

  fetchOrderLineItemDetails: async (dispatch, id) => {
    dispatch({ type: actionDescriptors.fetchOrderLineItemDetails });

    try {
      const response = await fetch(`${apiUrl}/orderLine/${id}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchOrderLineItemDetailsSuccessful,
          payload: body.data,
        });

        return true;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchOrderLineItemDetailsFailed,
          error: "Unauthorized while fetching Item"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.fetchOrderLineItemDetailsFailed,
        error: body.error,
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchOrderLineItemDetailsFailed,
        error: "Error while fetching Item",
      });
    }
  },

  fetchOrder: async (dispatch, limit, offset, commonName, selectedDate, filter, order, search) => {
    dispatch({ type: actionDescriptors.fetchOrder });

    let query = "";
    if (selectedDate) {
      let end = selectedDate + 86400;
      query = selectedDate ? query.concat(`&range[]=createdDate,${selectedDate},${end}`) : query;
    }
    if (filter) {
      query = filter !== 0 ? query.concat(`&status=${filter}`) : query;
    }
    if (search) {
      const searchValue = isNaN(search) ? search : parseInt(search);
      if (!isNaN(searchValue)) {
        query = search ? query.concat(`&orderId=${searchValue}`) : query;
      } else {
        query = search ? query.concat(`&queryValue=${searchValue}&queryFields=sellersCommonName`) : query;
      }
    }

    const encodedCommonName = encodeURIComponent(commonName);
    try {
      const response = await fetch(
        `${apiUrl}/order?limit=${limit}&offset=${offset}&order=${order}&purchasersCommonName=${encodedCommonName}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchOrderSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchOrderFailed,
          error: "Unauthorized while fetching order"
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({ type: actionDescriptors.fetchOrderFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchOrderFailed, error: undefined });
    }
  },

  fetchOrderSold: async (dispatch, limit, offset, commonName, selectedDate, filter, order, search) => {
    dispatch({ type: actionDescriptors.fetchOrderSold });
    const encodedCommonName = encodeURIComponent(commonName);
    let query = "";
    if (selectedDate) {
      let end = selectedDate + 86400;
      query = selectedDate ? query.concat(`&range[]=createdDate,${selectedDate},${end}`) : query;
    }
    if (filter) {
      query = filter !== 0 ? query.concat(`&status=${filter}`) : query;
    }

    if (search) {
      const searchValue = isNaN(search) ? search : parseInt(search);
      if (!isNaN(searchValue)) {
        query = search ? query.concat(`&orderId=${searchValue}`) : query;
      } else {
        query = search ? query.concat(`&queryValue=${searchValue}&queryFields=purchasersCommonName`) : query;
      }
    }

    try {
      const response = await fetch(
        `${apiUrl}/order?&limit=${limit}&offset=${offset}&order=${order}&sellersCommonName=${encodedCommonName}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchOrderSoldSuccessful,
          payload: body.data,
        });
        return;
      }
      else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchOrderSoldFailed,
          error: "Unauthorized while fetching order sold"
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.fetchOrderSoldFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchOrderSoldFailed,
        error: undefined,
      });
    }
  },
  
  fetchAllOrders: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchAllOrders });
    
    try {
      const ordersSold = await fetch(
        `${apiUrl}/order/exportOrders`,
        {
          method: HTTP_METHODS.GET,
        }
      );
      
      const bodysold = await ordersSold.json();
      
      if (ordersSold.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchAllOrdersSuccessful,
          payload: {bodySold: bodysold.data.soldOrders, bodyBought: bodysold.data.boughtOrders, bodyTransfers: bodysold.data.transfers},
        });
        return;
      }
      else if (bodysold.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchAllOrdersFailed,
          error: "Unauthorized while fetching all orders"
        });
        window.location.href = bodysold.error.loginUrl
      }
      dispatch({
        type: actionDescriptors.fetchAllOrdersFailed,
        error: bodysold.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchAllOrdersFailed,
        error: undefined,
      });
    }
  },

  updateBuyerDetails: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateBuyerDetails });

    try {
      const response = await fetch(`${apiUrl}/order/updateBuyerDetails`, {
        method: HTTP_METHODS.PUT,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.updateBuyerDetailsSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Order has been updated", true);
        return true;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.updateBuyerDetailsFailed,
          error: "Unauthorized while updating Order"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateBuyerDetailsFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateBuyerDetailsFailed,
        error: "Error while updating Order",
      });
      actions.setMessage(dispatch, "Error while updating Order");
    }
  },

  updateSellerDetails: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateSellerDetails });

    try {
      const response = await fetch(`${apiUrl}/order/updateSellerDetails`, {
        method: HTTP_METHODS.PUT,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.updateSellerDetailsSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Order has been updated", true);
        return true;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.updateSellerDetailsFailed,
          error: "Unauthorized while updating Order"
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateSellerDetailsFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateSellerDetailsFailed,
        error: "Error while updating Order",
      });
      actions.setMessage(dispatch, "Error while updating Order");
    }
  },

  executeSale: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.executeSale });

    try {
      const response = await fetch(`${apiUrl}/order/closeSale`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.executeSaleSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Order fulfilled successfully", true);
        return body.data;
      }

      dispatch({
        type: actionDescriptors.executeSaleFailed,
        error: "Error while fulfilling order",
      });
      actions.setMessage(dispatch, "Error while fulfilling order");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.executeSaleFailed,
        error: "Error while fulfilling order",
      });
      actions.setMessage(dispatch, "Error while fulfilling order");
    }
  },

  updateOrderComment: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateOrderComment });

    try {
      const response = await fetch(`${apiUrl}/order/updateComment`, {
        method: HTTP_METHODS.PUT,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.updateOrderCommentSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Comment updated successfully", true);
        return body.data;
      }

      dispatch({
        type: actionDescriptors.updateOrderCommentFailed,
        error: "Error while updating comment",
      });
      actions.setMessage(dispatch, "Error while updating comment");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateOrderCommentFailed,
        error: "Error while updating comment",
      });
      actions.setMessage(dispatch, "Error while updating comment");
    }
  },

  cancelSale: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.cancelSale });

    try {
      const response = await fetch(`${apiUrl}/order/sale/cancel`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.cancelSaleSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Sale canceled successfully", true);
        return body.data;
      }

      dispatch({
        type: actionDescriptors.cancelSaleFailed,
        error: "Error while canceling sale",
      });
      actions.setMessage(dispatch, "Error while canceling sale");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.cancelSaleFailed,
        error: "Error while canceling Sale",
      });
      actions.setMessage(dispatch, "Error while canceling sale");
    }
  },

  createSaleOrder: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createSaleOrder });

    try {
      const response = await fetch(`${apiUrl}/order/sale`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createSaleOrderSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Sale created successfully", true);
        return body.data;
      }

      dispatch({
        type: actionDescriptors.createSaleOrderFailed,
        error: "Error while executing sale",
      });
      actions.setMessage(dispatch, "Error while creating sale");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createSaleOrderFailed,
        error: "Error while creating Sale",
      });
      actions.setMessage(dispatch, "Error while creating sale");
    }
  },

  updateOrderStatus: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createSaleOrder });

    try {
      const response = await fetch(`${apiUrl}/order/update/`, {
        method: HTTP_METHODS.PUT,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.updateOrderStatusSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Order Updated Successfully", true);
        return body.data;
      }

      dispatch({
        type: actionDescriptors.updateOrderStatusFailed,
        error: "Error Updating Order Status",
      });
      actions.setMessage(dispatch, "Error While Updating Order Status");
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateOrderStatusFailed,
        error: "Error While Updating Order Status",
      });
      actions.setMessage(dispatch, "Error While Updating Order Status");
    }
  },
};

export { actionDescriptors, actions };