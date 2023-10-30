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
      }

      dispatch({
        type: actionDescriptors.fetchOrderDetailsFailed,
        error:body.error,
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

  fetchOrder: async (dispatch, limit, offset, queryValue, organization, order, selectedDate, filter) => {
    let query = queryValue ? `&orderId=${queryValue}` : "";
    let end = selectedDate + 86400;
    query = selectedDate ? query.concat(`&range[]=orderDate,${selectedDate},${end}`) : "query";
    
    query = filter !== 0 ? query.concat(`&status=${filter}`) : query;
    
    dispatch({ type: actionDescriptors.fetchOrder });

    try {
      const response = await fetch(
        `${apiUrl}/order?limit=${limit}&offset=${offset}&${query}&order=${order}&buyerOrganization=${organization}`,
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
      }
      dispatch({ type: actionDescriptors.fetchOrderFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchOrderFailed, error: undefined });
    }
  },

  fetchOrderSold: async (dispatch, limit, offset, queryValue, organization, order, selectedDate, filter) => {
    let query = queryValue ? `&orderId=${queryValue}` : "";
    let end = selectedDate + 86400;
    query = selectedDate ? query.concat(`&range[]=orderDate,${selectedDate},${end}`) : query;

    query = filter !== 0  ? query.concat(`&status=${filter}`) : query;

    dispatch({ type: actionDescriptors.fetchOrderSold });
    console.log("sellerOrganization", organization)
    try {
      const response = await fetch(
        `${apiUrl}/order?&limit=${limit}&offset=${offset}&order=${order}&${query}&sellerOrganization=${organization}`,
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
      }

      dispatch({
        type: actionDescriptors.updateSellerDetailsFailed,
        error: body.error,
      });
      actions.setMessage(dispatch,body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateSellerDetailsFailed,
        error: "Error while updating Order",
      });
      actions.setMessage(dispatch, "Error while updating Order");
    }
  }
};

export { actionDescriptors, actions };