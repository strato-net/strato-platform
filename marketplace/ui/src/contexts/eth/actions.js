import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  resetMessage: 'reset_message',
  setMessage: 'set_message',

  fetchBridgeableTokens: 'fetch_bridgeable_tokens',
  fetchBridgeableTokensSuccessful: 'fetch_bridgeable_tokens_successful',
  fetchBridgeableTokensFailed: 'fetch_bridgeable_tokens_failed',

  addHash: 'add_hash',
  addHashSuccessful: 'add_hash_successful',
  addHashFailed: 'add_hash_failed',
  bridgeOut: 'bridge_out',
  bridgeOutSuccessful: 'bridge_out_successful',
  bridgeOutFailed: 'bridge_out_failed',
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  fetchBridgeableTokens: async (dispatch) => {
    dispatch({ type: actionDescriptors.fetchBridgeableTokens });
    try {
      let response = await fetch(`${apiUrl}/tokens/bridgeableTokens`, {
        method: HTTP_METHODS.GET,
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (
        response.status === RestStatus.UNAUTHORIZED ||
        response.status === RestStatus.FORBIDDEN
      ) {
        dispatch({
          type: actionDescriptors.fetchBridgeableTokensFailed,
          payload: 'Error while fetching Bridgeable address',
        });
        return null;
      }

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchBridgeableTokensSuccessful,
          payload: body?.data,
        });
        return body.data;
      }

      dispatch({
        type: actionDescriptors.fetchBridgeableTokensFailed,
        payload: 'Error while fetching Bridgeable address',
      });
      return null;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchBridgeableTokensFailed,
        payload: 'Error while fetching Bridgeable address',
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
        actions.setMessage(dispatch, `Successfully initiated the bridging of ${payload.amount} ${payload.tokenName.toLowerCase().endsWith("st") ? payload.tokenName.slice(0, -2) : payload.tokenName} to ${payload.amount} ${payload.tokenName}.`, true);
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

  bridgeOut: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.bridgeOut });

    try {
      const { tokenName, quantityNumber, ...restPayload } = payload;
      const response = await fetch(`${apiUrl}/tokens/bridgeOut`, {
        method: HTTP_METHODS.POST,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(restPayload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.bridgeOutSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, `Successfully initiated the bridging of ${quantityNumber} ${tokenName.toLowerCase().endsWith("st") ? tokenName.slice(0, -2) : tokenName} to ${quantityNumber} ${tokenName}.`, true);
        return true;
      } else if (response.status === RestStatus.CONFLICT) {
        dispatch({
          type: actionDescriptors.bridgeOutFailed,
          error: body.error.message,
        });
        actions.setMessage(dispatch, body.error.message);
        return false;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.bridgeOutFailed,
          error: 'Error while bridging',
        });
        actions.setMessage(dispatch, 'Error while bridging');
        return false;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.bridgeOutFailed,
          error: 'Unauthorized while bridging',
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({
        type: actionDescriptors.bridgeOutFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.bridgeOutFailed,
        error: 'Error while bridging',
      });
      actions.setMessage(dispatch, 'Error while bridging');
    }
  },
};

export { actionDescriptors, actions };
