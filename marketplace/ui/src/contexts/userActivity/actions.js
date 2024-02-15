import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  fetchUserActivity: "fetch_user",
  fetchUserActivitySuccessful: "fetch_user_successful",
  fetchUserActivityFailed: "fetch_user_failed",
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  fetchUserActivity: async (dispatch, body) => {
    dispatch({ type: actionDescriptors.fetchUserActivity });
    const { user, gtValue, gtField } = body
    console.log("body", body)
    try {
      const ordersSold = await fetch(
        `${apiUrl}/userActivity?sellersCommonName=${user}&gtValue=${gtValue}&gtField=${gtField}&purchasersCommonName=${user}&newOwnerCommonName=${user}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const bodysold = await ordersSold.json();

      if (ordersSold.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchUserActivitySuccessful,
          payload: { bodySold: bodysold.data.soldOrders, bodyBought: bodysold.data.boughtOrders, bodyTransfers: bodysold.data.transfers },
        });
        return;
      }
      else if (bodysold.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.fetchUserActivityFailed,
          error: "Unauthorized while fetching all orders"
        });
        window.location.href = bodysold.error.loginUrl
      }
      dispatch({
        type: actionDescriptors.fetchUserActivityFailed,
        error: bodysold.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchUserActivityFailed,
        error: undefined,
      });
    }
  },
};

export { actionDescriptors, actions };
