import RestStatus from "http-status-codes";
import { cirrusUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchStorage: "fetch_storage",
  fetchStorageSuccessful: "fetch_storage_successful",
  fetchStorageFailed: "fetch_storage_failed",
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  fetchStorage: async (dispatch, limit, offset, table, queryValue) => {
    const query = queryValue ? `&contractName=${queryValue}` : "";

    dispatch({ type: actionDescriptors.fetchStorage });

    try {
      const response = await fetch(
        `${cirrusUrl}/${table}?limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchStorageSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchStorageFailed,
          error: `Error while fetching from the ${table} table`,
        });
      }
      dispatch({
        type: actionDescriptors.fetchStorageFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchStorageFailed,
        error: `Error while fetching from the ${table} table`,
      });
    }
  },

};

export { actionDescriptors, actions };