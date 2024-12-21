import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  resetMessage: 'reset_message',
  setMessage: 'set_message',
  fetchETHSTAddress: 'fetch_ethst_address',
  fetchETHSTAddressSuccessful: 'fetch_ethst_address_successful',
  fetchETHSTAddressFailed: 'fetch_ethst_address_failed',
  addHash: 'add_hash',
  addHashSuccessful: 'add_hash_successful',
  addHashFailed: 'add_hash_failed',
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  fetchETHSTAddress: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchETHSTAddress });
    try {
      let response = await fetch(`${apiUrl}/tokens/address`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchETHSTAddressFailed,
          payload: 'Error while fetching ETHST address',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchETHSTAddressSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchETHSTAddressFailed,
        payload: 'Error while fetching ETHST address',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchETHSTAddressFailed,
        payload: 'Error while fetching ETHST address',
      });
      return null;
    }
  },

  addHash: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.addHash });

    try {
      const response = await fetch(`${apiUrl}/tokens/addHash`, {
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
          type: actionDescriptors.addHashSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, 'Hash added successfully', true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.addHashFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.addHashFailed,
          error: 'Error while adding Hash',
        });
        actions.setMessage(dispatch, 'Error while adding Hash');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.addHashFailed,
          error: 'Unauthorized while adding Hash',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.addHashFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.addHashFailed,
        error: 'Error while adding Hash',
      });
      actions.setMessage(dispatch, 'Error while adding Hash');
    }
  },
};

export { actionDescriptors, actions };
