import RestStatus from 'http-status-codes';
import { apiUrl, HTTP_METHODS } from '../../helpers/constants';

const actionDescriptors = {
  getPaymentServices: 'get_payment_services',
  getPaymentServicesSuccessful: 'get_payment_services_successful',
  getPaymentServicesFailed: 'get_payment_services_failed',
  getNotOnboarded: 'get_not_onboarded',
  getNotOnboardedSuccessful: 'get_not_onboarded_successful',
  getNotOnboardedFailed: 'get_not_onboarded_failed',
};

const actions = {
  getPaymentServices: async (dispatch, queryValue) => {
    const query = queryValue ? `&onlyActive=${queryValue}` : ``;

    dispatch({ type: actionDescriptors.getPaymentServices });

    try {
      const response = await fetch(`${apiUrl}/payment?${query}`, {
        method: HTTP_METHODS.GET,
      });

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
          error: 'Error while fetching payment services',
        });
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.getPaymentServicesFailed,
          error: 'Unauthorized while fetching payment services',
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
        error: 'Error while fetching payment services',
      });
    }
  },

  getNotOnboarded: async (dispatch, sellersCommonName, limit, offset) => {
    const query = `&sellersCommonName=${sellersCommonName}`;

    dispatch({ type: actionDescriptors.getNotOnboarded });

    try {
      const response = await fetch(
        `${apiUrl}/payment/onboarding?limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.getNotOnboardedSuccessful,
          payload: { data: body.data, count: body.data.count },
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.getNotOnboardedFailed,
          error: 'Error while fetching unonboarded payment services',
        });
      } else if (response.status === RestStatus.UNAUTHORIZED) {
        dispatch({
          type: actionDescriptors.getNotOnboardedFailed,
          error: 'Unauthorized while fetching unonboarded payment services',
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({
        type: actionDescriptors.getNotOnboardedFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.getNotOnboardedFailed,
        error: 'Error while fetching unonboarded payment services',
      });
    }
  },
};

export { actionDescriptors, actions };
