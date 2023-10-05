import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {

  createServicesUsage: "create_service_usage",
  createServiceUsageSuccessful: "create_service_usage_successful",
  createServiceUsageFailed: "create_service_usage_failed",

  createBookedServiceUsage: "create_booked_service_usage",
  createBookedServiceUsageSuccessful: "create_booked_service_usage_successful",
  createBookedServiceUsageFailed: "create_booked_service_usage_failed",

  createProvidedServiceUsage: "create_provided_service_usage",
  createProvidedServiceUsageSuccessful: "create_provided_service_usage_successful",
  createProvidedServiceUsageFailed: "create_provided_service_usage_failed",

  fetchAllServicesUsage: "fetch_all_service_usage",
  fetchAllServiceUsageSuccessful: "fetch_all_service_usage_successful",
  fetchAllServiceUsageFailed: "fetch_all_service_usage_failed",

  fetchBookedServicesUsage: "fetch_booked_service_usage",
  fetchBookedServiceUsageSuccessful: "fetch_booked_service_usage_successful",
  fetchBookedServiceUsageFailed: "fetch_booked_service_usage_failed",

  fetchProvidedServicesUsage: "fetch_provided_service_usage",
  fetchProvidedServiceUsageSuccessful: "fetch_provided_service_usage_successful",
  fetchProvidedServiceUsageFailed: "fetch_provided_service_usage_failed",

  fetchServicesUsage: "fetch_service_usage",
  fetchServiceUsageSuccessful: "fetch_service_usage_successful",
  fetchServiceUsageFailed: "fetch_service_usage_failed",

  updateServiceUsage: "update_service_usage",
  updateServiceUsageSuccessful: "update_service_usage_successful",
  updateServiceUsageFailed: "update_service_usage_failed",

  updateBookedServiceUsage: "update_booked_service_usage",
  updateBookedServiceUsageSuccessful: "update_booked_service_usage_successful",
  updateBookedServiceUsageFailed: "update_booked_service_usage_failed",

  updateProvidedServiceUsage: "update_provided_service_usage",
  updateProvidedServiceUsageSuccessful: "update_provided_service_usage_successful",
  updateProvidedServiceUsageFailed: "update_provided_service_usage_failed",

  resetMessage: "reset_message",
  setMessage: "set_message",
  resetState: "reset_state"
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },
  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },
  resetState: (dispatch) => {
    dispatch({ type: actionDescriptors.resetState });
  },

  createServiceUsage: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createServicesUsage });

    try {
      const response = await fetch(`${apiUrl}/serviceUsage`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createServiceUsageSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Service usage created successfully", true)
        actions.fetchBookedServicesUsage(dispatch, 10, 0, '');
        return body.data
      }

      dispatch({ type: actionDescriptors.createServiceUsageFailed, error: 'Error while creating service usage' });
      actions.setMessage(dispatch, "Error while creating service usage")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createServiceUsageFailed, error: "Error while creating service usage" });
      actions.setMessage(dispatch, "Error while creating service usage")
    }
  },
  createBookedServiceUsage: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createServicesUsage });

    try {
      const response = await fetch(`${apiUrl}/serviceUsage`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createBookedServiceUsageSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Booked Service usage created successfully", true)
        actions.fetchBookedServicesUsage(dispatch, 10, 0, '');
        return body.data
      }

      dispatch({ type: actionDescriptors.createBookedServiceUsageFailed, error: 'Error while creating booked service usage' });
      actions.setMessage(dispatch, "Error while creating booked service usage")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createBookedServiceUsageFailed, error: "Error while creating booked service usage" });
      actions.setMessage(dispatch, "Error while creating booked service usage")
    }
  },
  createProvidedServiceUsage: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createServicesUsage });

    try {
      const response = await fetch(`${apiUrl}/serviceUsage`, {
        method: HTTP_METHODS.POST,
        credentials: "same-origin",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.createServiceUsageSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Service usage created successfully", true)
        actions.fetchProvidedServicesUsage(dispatch, 10, 0, '');
        return body.data
      }

      dispatch({ type: actionDescriptors.createProvidedServiceUsageFailed, error: 'Error while creating provided service usage' });
      actions.setMessage(dispatch, "Error while creating service usage")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createProvidedServiceUsageFailed, error: "Error while creating provided service usage" });
      actions.setMessage(dispatch, "Error while creating service usage")
    }
  },
  fetchAllServicesUsage: async (dispatch, limit, offset, query) => {
    actions.resetState(dispatch)
    dispatch({ type: actionDescriptors.fetchAllServicesUsage });
    try {
      const response = await fetch(`${apiUrl}/serviceUsage?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchAllServiceUsageSuccessful,
          payload: body.data,
        });
        return body.data;
      }
      dispatch({ type: actionDescriptors.fetchAllServiceUsageFailed, error: 'Error while fetching all Service Usage' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchAllServiceUsageFailed, error: "Error while fetching all Service Usage" });
    }
  },
  fetchBookedServicesUsage: async (dispatch, limit, offset, query) => {
    actions.resetState(dispatch)
    dispatch({ type: actionDescriptors.fetchBookedServicesUsage });
    try {
      const response = await fetch(`${apiUrl}/serviceUsage/booked?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchBookedServiceUsageSuccessful,
          payload: body.data,
        });
        return body.data;
      }
      dispatch({ type: actionDescriptors.fetchBookedServiceUsageFailed, error: 'Error while fetching all Booked Service Usage' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchBookedServiceUsageFailed, error: "Error while fetching all Booked Service Usage" });
    }
  },
  fetchProvidedServicesUsage: async (dispatch, limit, offset, query) => {
    actions.resetState(dispatch)
    dispatch({ type: actionDescriptors.fetchProvidedServicesUsage });

    try {
      const response = await fetch(`${apiUrl}/serviceUsage/provided?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchProvidedServiceUsageSuccessful,
          payload: body.data,
        });
        return body.data;
      }
      dispatch({ type: actionDescriptors.fetchProvidedServiceUsageFailed, error: 'Error while fetching all Provided Service Usage' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchProvidedServiceUsageFailed, error: "Error while fetching all Provided Service Usage" });
    }
  },
  fetchServicesUsage: async (dispatch, id) => {
    dispatch({ type: actionDescriptors.fetchServicesUsage });

    try {
      const response = await fetch(`${apiUrl}/serviceUsage/${id}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchServiceUsageSuccessful,
          payload: body.data,
        });
        return body.data;
      }
      dispatch({ type: actionDescriptors.fetchServiceUsageFailed, error: 'Error while fetching Service Usage' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchServiceUsageFailed, error: "Error while fetching Service Usage" });
    }
  },
  UpdateServiceUsage: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateServiceUsage });

    try {
      const response = await fetch(`${apiUrl}/serviceUsage/update`, {
        method: HTTP_METHODS.PUT,
        credentials: "same-origin",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.updateServiceUsageSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Service usage has been updated", true);
        actions.fetchBookedServicesUsage(dispatch, 10, 0, '')
        return true;
      }

      dispatch({ type: actionDescriptors.updateServiceUsageFailed, error: 'Error while updating service usage' });
      actions.setMessage(dispatch, "Error while updating service usage")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateServiceUsageFailed, error: "Error while updating service usage" });
      actions.setMessage(dispatch, "Error while updating service usage")
    }
  },
  UpdateBookedServiceUsage: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateBookedServiceUsage });

    try {
      const response = await fetch(`${apiUrl}/serviceUsage/update`, {
        method: HTTP_METHODS.PUT,
        credentials: "same-origin",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.updateBookedServiceUsageSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Booked Service usage has been updated", true);
        actions.fetchBookedServicesUsage(dispatch, 10, 0, '')
        return true;
      }

      dispatch({ type: actionDescriptors.updateBookedServiceUsageFailed, error: 'Error while updating booked service usage' });
      actions.setMessage(dispatch, "Error while updating booked service usage")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateBookedServiceUsageFailed, error: "Error while updating booked service usage" });
      actions.setMessage(dispatch, "Error while updating booked service usage")
    }
  },
  UpdateProvidedServiceUsage: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateProvidedServiceUsage });

    try {
      const response = await fetch(`${apiUrl}/serviceUsage/update`, {
        method: HTTP_METHODS.PUT,
        credentials: "same-origin",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.updateProvidedServiceUsageSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Provided Service usage has been updated", true);
        actions.fetchProvidedServicesUsage(dispatch, 10, 0, '')
        return true;
      }

      dispatch({ type: actionDescriptors.updateProvidedServiceUsageFailed, error: 'Error while updating provided service usage' });
      actions.setMessage(dispatch, "Error while updating service usage")
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateProvidedServiceUsageFailed, error: "Error while updating provided service usage" });
      actions.setMessage(dispatch, "Error while updating provided service usage")
    }
  },

};

export { actionDescriptors, actions };
