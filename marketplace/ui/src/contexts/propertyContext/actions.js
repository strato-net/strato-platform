import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

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

  addReview: "add_review",
  addReviewSuccessful: "add_review_successful",
  addReviewFailed: "add_review_failed",
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
      const response = await fetch(`${apiUrl}/updateproperties`, {
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
          type: actionDescriptors.updatePropertySuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Property updated successfully", true);
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

  fetchProperties: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue
      ? `&queryValue=${queryValue}&queryFields=name`
      : "";

    dispatch({ type: actionDescriptors.fetchProperties });

    try {
      const response = await fetch(
        `${apiUrl}/properties?limit=${limit}&offset=${offset}${query}`,
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
        error: body.error,
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

  addReview: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.addReview, payload })
    try {
      const response = await fetch(`${apiUrl}/addreview`, {
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
          type: actionDescriptors.addReviewSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Review added successfully", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.addReviewFailed,
          error: "Error while adding review",
        });
        actions.setMessage(dispatch, "Error while adding review");
        return false;
      }

      dispatch({
        type: actionDescriptors.addReviewFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.addReviewFailed,
        error: "Error while adding review",
      });
      actions.setMessage(dispatch, "Error while adding review");
    }
  },
  updateReview: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateReview, payload })
    try {
      const response = await fetch(`${apiUrl}/updatereview`, {
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
      const response = await fetch(`${apiUrl}/deletereview`, {
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