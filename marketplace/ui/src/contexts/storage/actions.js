import RestStatus from "http-status-codes";
import { cirrusUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchAssets: "fetch_assets",
  fetchAssetsSuccessful: "fetch_assets_successful",
  fetchAssetsFailed: "fetch_assets_failed",
  fetchSales: "fetch_sales",
  fetchSalesSuccessful: "fetch_sales_successful",
  fetchSalesFailed: "fetch_sales_failed",
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  fetchAssets: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue ? `&contractName=${queryValue}` : "";

    dispatch({ type: actionDescriptors.fetchAssets });

    try {
      const response = await fetch(
        `${cirrusUrl}/Asset?limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchAssetsSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchAssetsFailed,
          error: "Error while fetching from the Asset table",
        });
      }
      dispatch({
        type: actionDescriptors.fetchAssetsFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchAssetsFailed,
        error: "Error while fetching from the Asset table",
      });
    }
  },

  fetchSales: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue ? `&contractName=${queryValue}` : "";

    dispatch({ type: actionDescriptors.fetchSales });

    try {
      const response = await fetch(
        `${cirrusUrl}/Sale?limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSalesSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchSalesFailed,
          error: "Error while fetching from the Sale table",
        });
      }
      dispatch({
        type: actionDescriptors.fetchSalesFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchSalesFailed,
        error: "Error while fetching from the Sale table",
      });
    }
  },

};

export { actionDescriptors, actions };