import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";
import { QueryKeys } from "../../components/PropertiesComponents/helpers/constants";

const actionDescriptors = {
  createProperty: "create_property",
  createPropertySuccessful: "create_property_successful",
  createPropertyFailed: "create_property_failed",
  updateProperty: "update_property",
  updatePropertySuccessful: "update_property_successful",
  updatePropertyFailed: "update_property_failed",
  fetchProperties: "fetch_properties",
  fetchPropertiesSuccessful: "fetch_properties_successful",
  fetchPropertiesFailed: "fetch_properties_failed",
  fetchPropertyDetails: "fetch_property_details",
  fetchPropertyDetailsSuccessful: "fetch_property_details_successful",
  fetchPropertyDetailsFailed: "fetch_property_details_failed",

  createReview: "create_review",
  createReviewSuccessful: "create_review_successful",
  createReviewFailed: "create_review_failed",
  updateReview: "update_review",
  updateReviewSuccessful: "update_review_successful",
  updateReviewfailed: "update_review_failed",
  deleteReview: "delete_review",
  deleteReviewSuccessful: "delete_review_successful",
  deleteReviewFailed: "delete_review_failed",

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
          Accept: "application/json"
        },
        body: payload,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createPropertySuccessful,
          payload: body.data,
          success: true
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

  updateProperty: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateProperty });
    try {
      const response = await fetch(`${apiUrl}/properties/update`, {
        method: HTTP_METHODS.PUT,
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
          type: actionDescriptors.updatePropertySuccessful,
          payload: body.data,
          success: true
        });
        actions.setMessage(dispatch, "Property updated successfully", true);
        actions.fetchPropertyDetails(dispatch, payload.propertyAddress)
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updatePropertyFailed,
          error: "Error while updating property",
        });
        actions.setMessage(dispatch, "Error while updating property");
        return false;
      }

      dispatch({
        type: actionDescriptors.updatePropertyFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updatePropertyFailed,
        error: "Error while updating property",
      });
      actions.setMessage(dispatch, "Error while updating property");
    }
  },

  fetchProperties: async (dispatch, limit, offset, options = {}) => {

    dispatch({ type: actionDescriptors.fetchProperties });

    const queryParams = [];

    if (options.min_Price && options.max_Price) {
      queryParams.push(`&range[]=listPrice,${options.min_Price},${options.max_Price}`);
    } else if (options.min_Price || options.max_Price) {
      const item = options.min_Price ? 'min_Price' : 'max_Price';
      queryParams.push(`&${item.includes('min') ? 'gte' : 'lte'}Query[]=${QueryKeys[item]},${options[item]}`);
    }

    for (const item in options) {
      if (item.includes('min') || item.includes('max')) {
        continue;
      }

      if (item === 'parking_Type') {
        queryParams.push(`&${options[item]}=true`);
      } else if (item === 'sort_By') {
        queryParams.push(`&sort=${QueryKeys[options[item]]}`);
      } else if (item === 'lot_Size_Area') {
        queryParams.push(`&gteQuery[]=${QueryKeys[item]},${options[item]}`);
      } else if (item === 'zip_code' || item === 'state' || item === 'property_Type' || item === 'ownerOrganization') {
        queryParams.push(`&${QueryKeys[item]}=${options[item]}`);
      }
    }

    const queryString = queryParams.join('');

    try {
      const response = await fetch(
        `${apiUrl}/properties?limit=${limit}&offset=${offset}${queryString}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchPropertiesSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchPropertiesFailed,
          error: "Error while fetching property list",
        });
      }
      dispatch({
        type: actionDescriptors.fetchPropertiesFailed,
        error: "Error while fetching property list",
      });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchPropertiesFailed,
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
          error: "Error while fetching property detail",
        });
        return;
      }
      dispatch({
        type: actionDescriptors.fetchPropertyDetailsFailed,
        error: "Error while fetching property detail",
      });
      return;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchPropertyDetailsFailed,
        error: "Error while fetching property detail",
      });

    }
  },

  createReview: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createReview, payload })
    try {
      const response = await fetch(`${apiUrl}/properties/review`, {
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
          type: actionDescriptors.createReviewSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Review added successfully", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.createReviewFailed,
          error: "Error while adding review",
        });
        actions.setMessage(dispatch, "Error while adding review");
        return false;
      }

      dispatch({
        type: actionDescriptors.createReviewFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.createReviewFailed,
        error: "Error while adding review",
      });
      actions.setMessage(dispatch, "Error while adding review");
    }
  },
  updateReview: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateReview, payload })
    try {
      const response = await fetch(`${apiUrl}/properties/review/update`, {
        method: HTTP_METHODS.PUT,
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
          type: actionDescriptors.updateReviewSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Review updated successfully", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.updateReviewfailed,
          error: "Error while updating review",
        });
        actions.setMessage(dispatch, "Error while updating review");
        return false;
      }

      dispatch({
        type: actionDescriptors.updateReviewfailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.updateReviewfailed,
        error: "Error while updating review",
      });
      actions.setMessage(dispatch, "Error while updating review");
    }
  },
  deleteReview: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.deleteReview, payload })
    try {
      const response = await fetch(`${apiUrl}/properties/review/delete`, {
        method: HTTP_METHODS.PUT,
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
          type: actionDescriptors.deleteReviewSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Review deleted successfully", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.deleteReviewFailed,
          error: "Error while deleting review",
        });
        actions.setMessage(dispatch, "Error while deleting review");
        return false;
      }

      dispatch({
        type: actionDescriptors.deleteReviewFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.deleteReviewFailed,
        error: "Error while deleting review",
      });
      actions.setMessage(dispatch, "Error while deleting review");
    }
  }
}

export { actions, actionDescriptors }