import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  getPaymentServices: "get_payment_services",
  getPaymentServicesSuccessful: "get_payment_services_successful",
  getPaymentServicesFailed: "get_payment_services_failed",
};

const actions = {

  getPaymentServices: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue ? `&serviceName=${queryValue}` : ``;

    dispatch({ type: actionDescriptors.getPaymentServices });

    try {
      const response = await fetch(
        `${apiUrl}/payment?limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.getPaymentServicesSuccessful,
          payload: { data: body.data, count: body.data.count },
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.getPaymentServicesFailed,
          error: "Error while fetching payment services",
        });
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.getPaymentServicesFailed,
          error: "Unauthorized while fetching payment services"
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.getPaymentServicesFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.getPaymentServicesFailed,
        error: "Error while fetching payment services",
      });
    }
  },

};

export { actionDescriptors, actions };
