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

  fetchUserTransaction: async (dispatch, limit, offset, commonName, selectedDate, filter, order, search) => {
    dispatch({ type: actionDescriptors.fetchUserTransaction });

    let query = "";
    // if (selectedDate) {
    //   let end = selectedDate + 86400;
    //   query = selectedDate ? query.concat(`&range[]=createdDate,${selectedDate},${end}`) : query;
    // }
    // if (filter) {
    //   query = filter !== 0 ? query.concat(`&status=${filter}`) : query;
    // }
    // if (search) {
    //   const searchValue = isNaN(search) ? search : parseInt(search);
    //   if (!isNaN(searchValue)) {
    //     query = search ? query.concat(`&orderId=${searchValue}`) : query;
    //   } else {
    //     query = search ? query.concat(`&queryValue=${searchValue}&queryFields=purchasersCommonName`) : query;
    //   }
    // }

    const encodedCommonName = encodeURIComponent(commonName);
    try {
      const response = await fetch(
        `${apiUrl}/transaction?limit=${limit}&offset=${offset}&type=${order}&user=${encodedCommonName}${query}`,
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