import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  fetchCertifiers : "fetch_certifiers",
  fetchCertifiersSuccessful : "fetch_certifiers_successful",
  fetchCertifiersFailed : "fetch_certifiers_failed"
};

const actions = {
  fetchCertifiers: async (dispatch) => {

    dispatch({ type: actionDescriptors.fetchCertifiers });

    try {
      const response = await fetch(`${apiUrl}/membership/certifiers/users/all`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchCertifiersSuccessful,
          payload: body.data,
        });
        return;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.fetchCertifiersFailed, error: "Error while fetching Certifiers" });
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.fetchCertifiersFailed, 
          error: "Unauthorized while fetching Certifiers" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({ type: actionDescriptors.fetchCertifiersFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchCertifiersFailed, error: "Error while fetching Certifiers"  });
    }
  },
};

export { actionDescriptors, actions };
