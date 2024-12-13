import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  resetMessage: 'reset_message',
  setMessage: 'set_message',
  fetchETHSTAddress: 'fetch_ethst_address',
  fetchETHSTAddressSuccessful: 'fetch_ethst_address_successful',
  fetchETHSTAddressFailed: 'fetch_ethst_address_failed',
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
      let response = await fetch(`${apiUrl}/eth/address`, {
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
};

export { actionDescriptors, actions };
