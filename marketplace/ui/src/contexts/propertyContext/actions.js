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

  fetchProperties: async (dispatch, limit, offset, options = {}, queryValue) => {

    dispatch({ type: actionDescriptors.fetchProperties });

    const { min_Price, max_Price, min_Bathrooms, zip_code, state, min_Bedrooms, lot_Size_Area, sort_By, parking_Type } = options

    let queryBuilder = "";
    Object.keys(options).map((item, index) => {
      console.log("QueryKeys[item]", QueryKeys[item], options[item], "item", item);
    
      switch (item) {
        case "min_Price":
          if (min_Price && max_Price) {
            queryBuilder += `&range[]=listPrice,${min_Price},${max_Price}`;
          }
          break;
    
        case "max_Price":
          if (min_Price && max_Price) {
            queryBuilder += `&range[]=listPrice,${min_Price},${max_Price}`;
          }
          break;
    
        case "lot_Size_Area":
          queryBuilder += `&gteQuery[]=${QueryKeys[item]},${options[item]}`;
          break;
    
        case "zip_code":
        case "state":
          queryBuilder += `&${QueryKeys[item]}=${options[item]}`;
          break;
    
        case "parking_Type":
          queryBuilder += `&${options[item]}=true`;
          break;
    
        case "sort_By":
          queryBuilder += `&sort=${QueryKeys[options[item]]}`;
          break;
    
        default:
          if (item.includes("min") || item.includes("max")) {
            queryBuilder += `&${item.includes("min") ? "gte" : "lte"}Query[]=${QueryKeys[options[item]]},${options[item]}`;
          }
          break;
      }
    });
    
    const priceQuery = min_Price || max_Price ? `&range[]=listPrice,${min_Price},${max_Price}` : '';
    const postalcodeQuery = zip_code ? `&postalcode=${zip_code}` : '';
    const stateOrProvinceQuery = state && state !== 'select' ? `&stateOrProvince=${state}` : '';
    const bedroomsTotalQuery = min_Bedrooms ? `&gteQuery[]=bedroomsTotal,${min_Bedrooms}` : '';
    const bathroomsTotalIntegerQuery = min_Bathrooms ? `&gteQuery[]=bathroomsTotalInteger,${min_Bathrooms}` : '';
    const lotSizeAreaQuey = lot_Size_Area ? `&gteQuery[]=lotSizeArea,${lot_Size_Area}` : '';
    const parkingTypeQuery = parking_Type && parking_Type !== 'select' ? `&${parking_Type}=true` : '';
    const sortByQuery = sort_By && sort_By !== 'select'
      ? `&sort=${sort_By.includes('min')
        ? encodeURIComponent(`+${sort_By.replace('min', '')}`)
        : encodeURIComponent(`-${sort_By.replace('max', '')}`)}`
      : '';

    const query = queryValue
      ? `&queryValue=${queryValue}&queryFields=name`
      : "";

    // const queryBuilder = `${query}${priceQuery}${postalcodeQuery}${stateOrProvinceQuery}${bedroomsTotalQuery}${bathroomsTotalIntegerQuery}${lotSizeAreaQuey}${sortByQuery}${parkingTypeQuery}`

    try {
      const response = await fetch(
        `${apiUrl}/properties?limit=${limit}&offset=${offset}${queryBuilder}`,
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