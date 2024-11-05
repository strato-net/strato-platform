import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  fetchUserTransaction: "fetch_users_transaction",
  fetchUserTransactionSuccessful: "fetch_users_transaction_successful",
  fetchUserTransactionFailed: "fetch_users_transaction_failed",
  fetchGlobalTransaction: "fetch_global_transaction",
  fetchGlobalTransactionSuccessful: "fetch_global_transaction_successful",
  fetchGlobalTransactionFailed: "fetch_global_transaction_failed",
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

  fetchUserTransaction: async (dispatch, limit, offset, commonName, dateRange) => {
    dispatch({ type: actionDescriptors.fetchUserTransaction });

    const encodedCommonName = encodeURIComponent(commonName);
    let query = "";
    if (limit) {
      query += `limit=${limit}`
    }
    if (offset) {
      query += `&offset=${offset}`
    }
    // if (commonName) {
    //   query += `&user=${encodedCommonName}`
    // }
    if(dateRange){
      query += `&startDate=${dateRange[0]}&endDate=${dateRange[1]}`
    }

    try {
      const response = await fetch(
        `${apiUrl}/transaction?${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUserTransactionSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchUserTransactionFailed,
          error: "Unauthorized while fetching UserTransaction"
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({ type: actionDescriptors.fetchUserTransactionFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchUserTransactionFailed, error: undefined });
    }
  },

};

export { actionDescriptors, actions };