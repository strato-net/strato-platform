import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  createOrder: 'create_order',
  createOrderSuccessful: 'create_order_successful',
  createOrderFailed: 'create_order_failed',
  createPayment: 'create_payment',
  createPaymentSuccessful: 'create_payment_successful',
  createPaymentFailed: 'create_payment_failed',
  createOrderLineItem: 'create_order_line_item',
  createOrderLineItemSuccessful: 'create_order_line_item_successful',
  createOrderLineItemFailed: 'create_order_line_item_failed',
  fetchOrder: 'fetch_orders',
  fetchOrderSuccessful: 'fetch_order_successful',
  fetchOrderFailed: 'fetch_order_failed',
  fetchOrderSold: 'fetch_orders_sold',
  fetchOrderSoldSuccessful: 'fetch_order_sold_successful',
  fetchOrderSoldFailed: 'fetch_order_sold_failed',
  fetchAllOrders: 'fetch_all_orders',
  fetchAllOrdersSuccessful: 'fetch_all_orders_successful',
  fetchAllOrdersFailed: 'fetch_all_orders_failed',
  fetchOrderDetails: 'fetch_order_details',
  fetchOrderDetailsSuccessful: 'fetch_order_details_successful',
  fetchOrderDetailsFailed: 'fetch_order_details_failed',
  fetchOrderLineItemDetails: 'fetch_order_line_item_details',
  fetchOrderLineItemDetailsSuccessful:
    'fetch_order_line_item_details_successful',
  fetchOrderLineItemDetailsFailed: 'fetch_order_line_item_details_failed',
  fetchSaleQuantity: 'fetch_sale_quantity',
  fetchSaleQuantitySuccessful: 'fetch_sale_quantity_successful',
  fetchSaleQuantityFailed: 'fetch_sale_quantity_failed',
  resetMessage: 'reset_message',
  setMessage: 'set_message',
  cancelSale: 'cancel_sale',
  cancelSaleSuccessful: 'cancel_sale_successful',
  cancelSaleFailed: 'cancel_sale_failed',
  executeSale: 'execute_sale',
  executeSaleSuccessful: 'execute_sale_successful',
  executeSaleFailed: 'execute_sale_failed',
  waitForOrderEvent: 'wait_for_order_event',
  waitForOrderEventSuccessful: 'wait_for_order_event_successful',
  waitForOrderEventFailed: 'wait_for_order_event_failed',
  updateOrderComment: 'update_order_comment',
  updateOrderCommentSuccessful: 'update_order_comment_successful',
  updateOrderCommentFailed: 'update_order_comment_failed',
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
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createOrderSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Order created successfully', true);
        return true;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createOrderFailed,
          error: 'Error while creating Order',
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
        error: 'Error while creating Order',
      });
      actions.setMessage(dispatch, 'Error while creating Order');
    }
  },

  createPayment: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createPayment });

    try {
      const response = await fetch(`${apiUrl}/order/payment`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createPaymentSuccessful,
          payload: body.data,
        });
        return body.data;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createPaymentFailed,
          error: 'Error while creating Order',
        });
        window.location.href = body.error.loginUrl;
      }

      let err = body.error || 'Error while creating Order';
      let errs = err.split('"');
      if (errs.length > 1) {
        err = errs[1];
      }
      dispatch({
        type: actionDescriptors.createPaymentFailed,
        error: err,
      });
      actions.setMessage(dispatch, err);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createPaymentFailed,
        error: 'Error while creating Order',
      });
      actions.setMessage(dispatch, 'Error while creating Order');
    }
  },

  createOrderLineItem: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createOrderLineItem });

    try {
      const response = await fetch(`${apiUrl}/orderLineItem`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createOrderLineItemSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Item created successfully', true);
        return true;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.createOrderLineItemFailed,
          error: 'Unauthorized while creating Item',
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
        error: 'Error while creating Item',
      });
      actions.setMessage(dispatch, 'Error while creating Item');
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
          error: 'Unauthorized while fetching Order',
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
        error: 'Error while fetching Order',
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
          error: 'Unauthorized while fetching Item',
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
        error: 'Error while fetching Item',
      });
    }
  },

  fetchOrder: async (
    dispatch,
    limit,
    offset,
    commonName,
    selectedDate,
    filter,
    order,
    search
  ) => {
    dispatch({ type: actionDescriptors.fetchOrder });

    let query = '';
    if (selectedDate) {
      let end = selectedDate + 86400;
      query = selectedDate
        ? query.concat(`&range[]=createdDate,${selectedDate},${end}`)
        : query;
    }
    if (filter) {
      query = filter !== 0 ? query.concat(`&status=${filter}`) : query;
    }
    if (search) {
      const searchValue = isNaN(search) ? search : parseInt(search);
      if (!isNaN(searchValue)) {
        query = search ? query.concat(`&orderId=${searchValue}`) : query;
      } else {
        query = search
          ? query.concat(
              `&queryValue=${searchValue}&queryFields=purchasersCommonName`
            )
          : query;
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
          error: 'Unauthorized while fetching order',
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({ type: actionDescriptors.fetchOrderFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchOrderFailed, error: undefined });
    }
  },

  fetchOrderSold: async (
    dispatch,
    limit,
    offset,
    commonName,
    selectedDate,
    filter,
    order,
    search
  ) => {
    dispatch({ type: actionDescriptors.fetchOrderSold });
    const encodedCommonName = encodeURIComponent(commonName);
    let query = '';
    if (selectedDate) {
      let end = selectedDate + 86400;
      query = selectedDate
        ? query.concat(`&range[]=createdDate,${selectedDate},${end}`)
        : query;
    }
    if (filter) {
      query = filter !== 0 ? query.concat(`&status=${filter}`) : query;
    }

    if (search) {
      const searchValue = isNaN(search) ? search : parseInt(search);
      if (!isNaN(searchValue)) {
        query = search ? query.concat(`&orderId=${searchValue}`) : query;
      } else {
        query = search
          ? query.concat(
              `&queryValue=${searchValue}&queryFields=sellersCommonName`
            )
          : query;
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
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchOrderSoldFailed,
          error: 'Unauthorized while fetching order sold',
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
      const ordersSold = await fetch(`${apiUrl}/order/exportOrders`, {
        method: HTTP_METHODS.GET,
      });

      const bodysold = await ordersSold.json();

      if (ordersSold.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchAllOrdersSuccessful,
          payload: {
            bodySold: bodysold.data.soldOrders,
            bodyBought: bodysold.data.boughtOrders,
            bodyTransfers: bodysold.data.transfers,
          },
        });
        return;
      } else if (bodysold.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchAllOrdersFailed,
          error: 'Unauthorized while fetching all orders',
        });
        window.location.href = bodysold.error.loginUrl;
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

  fetchSaleQuantity: async (dispatch, saleAddresses, orderQuantity) => {
    dispatch({ type: actionDescriptors.fetchSaleQuantity });
    try {
      const response = await fetch(`${apiUrl}/order/saleQuantity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ saleAddresses, orderQuantity }),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSaleQuantitySuccessful,
          payload: body.data,
        });

        return body.data;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchSaleQuantityFailed,
          error: 'Unauthorized while fetching sales',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.fetchSaleQuantityFailed,
        error: body.error,
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchSaleQuantityFailed,
        error: 'Error while fetching Order',
      });
    }
  },

  executeSale: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.executeSale });

    try {
      const response = await fetch(`${apiUrl}/order/closeSale`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.executeSaleSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Order fulfilled successfully', true);
        return body.data;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.executeSaleFailed,
          error: 'Unauthorized while fetching users',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.executeSaleFailed,
        error: 'Error while fulfilling order',
      });
      actions.setMessage(dispatch, 'Error while fulfilling order');
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.executeSaleFailed,
        error: 'Error while fulfilling order',
      });
      actions.setMessage(dispatch, 'Error while fulfilling order');
    }
  },

  waitForOrderEvent: async (dispatch, orderHash) => {
    dispatch({ type: actionDescriptors.waitForOrderEvent });

    try {
      const response = await fetch(
        `${apiUrl}/order/wait/event?orderHash=${orderHash}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.waitForOrderEventSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Order retrieved successfully', true);
        return body.data;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.waitForOrderEventFailed,
          error: 'Unauthorized while fetching users',
        });
        window.location.href = body.error.loginUrl;
      } else if (response.status === RestStatus.GATEWAY_TIMEOUT) {
        dispatch({
          type: actionDescriptors.waitForOrderEventFailed,
          error:
            'There was a problem processing your order, reach out to sales@blockapps.net for next steps.',
        });
      }

      dispatch({
        type: actionDescriptors.waitForOrderEventFailed,
        error: 'Error while fulfilling order',
      });
      actions.setMessage(dispatch, 'Error while retrieving order');
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.waitForOrderEventFailed,
        error: 'Error while fulfilling order',
      });
      actions.setMessage(dispatch, 'Error while retrieving order');
    }
  },

  updateOrderComment: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateOrderComment });

    try {
      const response = await fetch(`${apiUrl}/order/updateComment`, {
        method: HTTP_METHODS.PUT,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.updateOrderCommentSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Comment updated successfully', true);
        return body.data;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.cancelSaleFailed,
          error: 'Unauthorized while cancelling Sale',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.updateOrderCommentFailed,
        error: 'Error while updating comment',
      });
      actions.setMessage(dispatch, 'Error while updating comment');
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateOrderCommentFailed,
        error: 'Error while updating comment',
      });
      actions.setMessage(dispatch, 'Error while updating comment');
    }
  },

  cancelSale: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.cancelSale });

    try {
      const response = await fetch(`${apiUrl}/order/sale/cancel`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.cancelSaleSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Sale canceled successfully', true);
        return body.data;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.cancelSaleFailed,
          error: 'Unauthorized while cancelling Sale',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.cancelSaleFailed,
        error: 'Error while canceling sale',
      });
      actions.setMessage(dispatch, 'Error while canceling sale');
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.cancelSaleFailed,
        error: 'Error while canceling Sale',
      });
      actions.setMessage(dispatch, 'Error while canceling sale');
    }
  },
};

export { actionDescriptors, actions };
