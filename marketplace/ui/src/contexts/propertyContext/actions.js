import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createProperty: "create_property",
  createPropertySuccessful: "create_property_successful",
  createPropertyFailed: "create_property_failed",
  fetchProperties: "fetch_properties",
  fetchPropertiesSuccessful: "fetch_properties_successful",
  fetchPropertiesFailed: "fetch_properties_failed",
  fetchPropertyDetails: "fetch_property_details",
  fetchPropertyDetailsSuccessful: "fetch_property_details_successful",
  fetchPropertyDetailsFailed: "fetch_property_details_failed",
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

  createProperty: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createProperty });
    try {
      const response = await fetch(`${apiUrl}/properties`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createPropertySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Property listing created successfully", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.createPropertyFailed,
          error: "Error while creating property listing",
        });
        actions.setMessage(dispatch, "Error while creating property listing");
        return false;
      }

      dispatch({
        type: actionDescriptors.createPropertyFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createPropertyFailed,
        error: "Error while creating property listing",
      });
      actions.setMessage(dispatch, "Error while creating property listing");
    }
  },

  fetchProperties: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue
      ? `&queryValue=${queryValue}&queryFields=name`
      : "";

    dispatch({ type: actionDescriptors.fetchProperties });

    try {
      const response = await fetch(
        `${apiUrl}/properties?isDeleted=false&limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchProductSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchProductFailed,
          error: "Error while fetching property list",
        });
      }
      dispatch({
        type: actionDescriptors.fetchProductFailed,
        error: body.error,
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchProductFailed,
        error: "Error while fetching property list",
      });
    }
  },

  fetchPropertyDetails: async (dispatch, id) => {
    dispatch({ type: actionDescriptors.fetchPropertyDetails })
    try {
      const response = await fetch(`${apiUrl}/properties/${id}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchPropertyDetailsSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchPropertyDetailsFailed,
          error: "Error while fetching property list",
        });
        return;
      }
      dispatch({
        type: actionDescriptors.fetchPropertyDetailsFailed,
        error: body.error,
      });
      return;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchPropertyDetailsFailed,
        error: "Error while fetching property detail",
      });
      
    }
  },
}

export { actions, actionDescriptors }