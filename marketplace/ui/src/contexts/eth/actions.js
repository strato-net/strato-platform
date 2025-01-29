import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  resetMessage: 'reset_message',
  setMessage: 'set_message',
  fetchETHSTAddress: 'fetch_ethst_address',
  fetchETHSTAddressSuccessful: 'fetch_ethst_address_successful',
  fetchETHSTAddressFailed: 'fetch_ethst_address_failed',
  fetchWBTCSTAddress: 'fetch_wbtcst_address',
  fetchWBTCSTAddressSuccessful: 'fetch_wbtcst_address_successful',
  fetchWBTCSTAddressFailed: 'fetch_wbtcst_address_failed',

  fetchUSDTAddress: 'fetch_usdt_address',
  fetchUSDTAddressSuccessful: 'fetch_usdt_address_successful',
  fetchUSDTAddressFailed: 'fetch_usdt_address_failed',

  fetchUSDCAddress: 'fetch_usdc_address',
  fetchUSDCAddressSuccessful: 'fetch_usdc_address_successful',
  fetchUSDCAddressFailed: 'fetch_usdc_address_failed',

  fetchPAXGAddress: 'fetch_paxg_address',
  fetchPAXGAddressSuccessful: 'fetch_paxg_address_successful',
  fetchPAXGAddressFailed: 'fetch_paxg_address_failed',

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

  fetchWBTCSTAddress: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchWBTCSTAddress });
    try {
      let response = await fetch(`${apiUrl}/tokens/wbtcstAddress`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchWBTCSTAddressFailed,
          payload: 'Error while fetching WBTCST address',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchWBTCSTAddressSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchWBTCSTAddressFailed,
        payload: 'Error while fetching WBTCST address',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchWBTCSTAddressFailed,
        payload: 'Error while fetching WBTCST address',
      });
      return null;
    }
  },

  fetchUSDTAddress: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchUSDTAddress });
    try {
      let response = await fetch(`${apiUrl}/tokens/usdtAddress`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchUSDTAddressFailed,
          payload: 'Error while fetching USDT address',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUSDTAddressSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchUSDTAddressFailed,
        payload: 'Error while fetching USDT address',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUSDTAddressFailed,
        payload: 'Error while fetching USDT address',
      });
      return null;
    }
  },

  fetchUSDCAddress: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchUSDCAddress });
    try {
      let response = await fetch(`${apiUrl}/tokens/usdcAddress`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchUSDCAddressFailed,
          payload: 'Error while fetching USDC address',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUSDCAddressSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchUSDCAddressFailed,
        payload: 'Error while fetching USDC address',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUSDCAddressFailed,
        payload: 'Error while fetching USDC address',
      });
      return null;
    }
  },

  fetchPAXGAddress: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchPAXGAddress });
    try {
      let response = await fetch(`${apiUrl}/tokens/paxgAddress`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchPAXGAddressFailed,
          payload: 'Error while fetching PAXG address',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchPAXGAddressSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchPAXGAddressFailed,
        payload: 'Error while fetching PAXG address',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchPAXGAddressFailed,
        payload: 'Error while fetching PAXG address',
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
        actions.setMessage(dispatch, `Successfully initiated the bridging of ${payload.amount} ${payload.tokenName} to ${payload.amount} ${payload.tokenName}ST.`, true);
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
          error: 'Error while bridging',
        });
        actions.setMessage(dispatch, 'Error while bridging');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.addHashFailed,
          error: 'Unauthorized while bridging',
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
        error: 'Error while bridging',
      });
      actions.setMessage(dispatch, 'Error while bridging');
    }
  },
};

export { actionDescriptors, actions };
