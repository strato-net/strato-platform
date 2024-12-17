import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  fetchUserTransaction: 'fetch_users_transaction',
  fetchUserTransactionSuccessful: 'fetch_users_transaction_successful',
  fetchUserTransactionFailed: 'fetch_users_transaction_failed',
  fetchGlobalTransaction: 'fetch_global_transaction',
  fetchGlobalTransactionSuccessful: 'fetch_global_transaction_successful',
  fetchGlobalTransactionFailed: 'fetch_global_transaction_failed',
  resetMessage: 'reset_message',
  setMessage: 'set_message',
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  fetchUserTransaction: async (
    dispatch,
    limit,
    offset,
    commonName,
    userAddress,
    dateRange,
    type
  ) => {
    dispatch({ type: actionDescriptors.fetchUserTransaction });

    const encodedCommonName = encodeURIComponent(commonName);
    let query = '';
    if (limit) {
      query += `limit=${limit}`;
    }
    if (offset) {
      query += `&offset=${offset}`;
    }
    if (commonName) {
      query += `&user=${encodedCommonName}`;
    }
    if (userAddress) {
      query += `&userAddress=${userAddress}`;
    }
    if (dateRange) {
      query += `&startDate=${dateRange[0]}&endDate=${dateRange[1]}`;
    }
    if (type) {
      query += `&type=${type}`;
    }

    try {
      const response = await fetch(`${apiUrl}/transaction/user?${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUserTransactionSuccessful,
          payload: body,
        });
        return;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchUserTransactionFailed,
          error: 'Unauthorized while fetching UserTransaction',
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.fetchUserTransactionFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUserTransactionFailed,
        error: undefined,
      });
    }
  },

  fetchGlobalTransaction: async (dispatch, limit, offset, type, dateRange) => {
    dispatch({ type: actionDescriptors.fetchGlobalTransaction });

    let query = '';
    if (limit) {
      query += `limit=${limit}`;
    }
    if (offset) {
      query += `&offset=${offset}`;
    }
    if (type?.length) {
      query += `&type=${type}`;
    }
    if (dateRange) {
      query += `&startDate=${dateRange[0]}&endDate=${dateRange[1]}`;
    }

    try {
      const response = await fetch(`${apiUrl}/transaction/global?${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchGlobalTransactionSuccessful,
          payload: body,
        });
        return;
      }
      dispatch({
        type: actionDescriptors.fetchGlobalTransactionFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchGlobalTransactionFailed,
        error: undefined,
      });
    }
  },
};

export { actionDescriptors, actions };
