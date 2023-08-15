import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createService: "create_service",
  createServiceSuccessful: "create_service_successful",
  createServiceFailed: "create_service_failed",
  fetchCertifyService: "fetch_certify_service",
  fetchCertifyServiceSuccessful: "fetch_certify_service_successful",
  fetchCertifyServiceFailed: "fetch_certify_service_failed",
  fetchService: "fetch_services",
  fetchServiceSuccessful: "fetch_service_successful",
  fetchServiceFailed: "fetch_service_failed",
  fetchServiceOfInventory: "fetch_service_of_inventory",
  fetchServiceOfInventorySuccessful: "fetch_service_of_inventory_successful",
  fetchServiceOfInventoryFailed: "fetch_service_of_inventory_failed",
  fetchServiceOfItem: "fetch_service_of_item",
  fetchServiceOfItemSuccessful: "fetch_service_of_item_successful",
  fetchServiceOfItemFailed: "fetch_service_of_item_failed",
  fetchServiceDetails: "fetch_service_details",
  fetchServiceDetailsSuccessful: "fetch_service_details_successful",
  fetchServiceDetailsFailed: "fetch_service_details_failed",
  updateService: "update_service",
  updateServiceSuccessful: "update_service_successful",
  updateServiceFailed: "update_service_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchServiceAudit: "fetch_service_audit",
  fetchServiceAuditSuccessful: "fetch_service_audit_successful",
  fetchServiceAuditFailed: "fetch_service_audit_failed",
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  createService: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createService });

    try {
      const response = await fetch(`${apiUrl}/service`, {
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
          type: actionDescriptors.createServiceSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Service created successfully", true)
        return true;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.createServiceFailed, error: "Error while creating Service" });
        actions.setMessage(dispatch, "Error while creating Service")
        return false;
      }

      dispatch({ type: actionDescriptors.createServiceFailed, error: body.error });
      actions.setMessage(dispatch, body.error)
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createServiceFailed,  error: "Error while creating Service" });
      actions.setMessage(dispatch,  "Error while creating Service")
    }
  },

  fetchServiceDetails: async (dispatch, id, chainId) => {
    dispatch({ type: actionDescriptors.fetchServiceDetails });

    try {
      const response = await fetch(`${apiUrl}/service/${id}/${chainId}`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchServiceDetailsSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchServiceDetailsFailed, error: 'Error while fetching Service' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchServiceDetailsFailed, error: "Error while fetching Service" });
    }
  },

  fetchService: async (dispatch, limit, offset, queryValue,organization) => {
    const query = queryValue
      ? `&serviceTypeId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchService });

    try {
      const response = await fetch(organization!=null?`${apiUrl}/service?limit=${limit}&offset=${offset}${query}&ownerOrganization=${organization}` :`${apiUrl}/service?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchServiceSuccessful,
          payload: body.data,
        });
        return;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.fetchServiceFailed, error: "Error while fetching Service" });
      }

      dispatch({ type: actionDescriptors.fetchServiceFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchServiceFailed, error: "Error while fetching Service"  });
    }
  },

  fetchCertifyService: async (dispatch) => {

    dispatch({ type: actionDescriptors.fetchCertifyService });

    try {
      const response = await fetch(`${apiUrl}/service?filterByCertifier=true`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchCertifyServiceSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ 
          type: actionDescriptors.fetchCertifyServiceFailed, 
          error: "Error while fetching certify services" 
        });
        actions.setMessage(dispatch, "Error while fetching certify services" )
      }
      dispatch({ 
        type: actionDescriptors.fetchCertifyServiceFailed, 
        error: body.error 
      });
      actions.setMessage(dispatch, body.error.message)
    } catch (err) {
      dispatch({ 
        type: actionDescriptors.fetchCertifyServiceFailed, 
        error: "Error while fetching certify services" 
      });
      actions.setMessage(dispatch, "Error while fetching certify services" )
    }
  },

  fetchServiceOfInventory: async (dispatch, limit, offset, queryValue,inventoryId) => {
    const query = queryValue
      ? `&serviceTypeId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchServiceOfInventory });

    try {
      const response = await fetch(`${apiUrl}/service/${inventoryId}?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      // const body = await response.json();
      const body = [
      {
        name: "Service 1",
        description: "Service 1 description",
        nonMemberPrice: 100,
        memberPrice: 50,
        uses: 10,
      },
      {
        name: "Service 2",
        description: "Service 2 description",
        nonMemberPrice: 200,
        memberPrice: 100,
        uses: 20,
      },
      {
        name: "Service 3",
        description: "Service 3 description",
        nonMemberPrice: 300,
        memberPrice: 150,
        uses: 30,
      }
      ]
      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchServiceOfInventorySuccessful,
          payload: body,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchServiceOfInventoryFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchServiceOfInventoryFailed, error: undefined });
    }
  },

  fetchServiceOfItem: async (dispatch, limit, offset, queryValue,itemId) => {
    const query = queryValue
      ? `&serviceTypeId=${queryValue}`
      : "";

    dispatch({ type: actionDescriptors.fetchServiceOfItem });

    try {
      const response = await fetch(`${apiUrl}/service?itemAddress=${itemId}&limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchServiceOfItemSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchServiceOfItemFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchServiceOfItemFailed, error: undefined });
    }
  },

  updateService: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.updateService });

    try {
      const response = await fetch(`${apiUrl}/service/update`, {
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
          type: actionDescriptors.updateServiceSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Certifier comment has been updated", true);
        return true;
      }else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.updateServiceFailed, error: 'Error while updating certifier comment' });
        return false;
      }

      dispatch({ type: actionDescriptors.updateServiceFailed, error: body.error });
      actions.setMessage(dispatch, body.error)
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.updateServiceFailed, error: "Error while updating certifier comment" });
      actions.setMessage(dispatch, "Error while updating certifier comment")
    }
  },
  fetchServiceAudit: async (dispatch, address, chainId) => {
    dispatch({ type: actionDescriptors.fetchServiceDetails });

    try {
      const response = await fetch(`${apiUrl}/service/${address}/${chainId}/audit`, {
        method: HTTP_METHODS.GET
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchServiceAuditSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({ type: actionDescriptors.fetchServiceAuditFailed, error: 'Error while fetching audit' });
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.fetchServiceAuditFailed, error: "Error while fetching audit" });
    }
  }
};

export { actionDescriptors, actions };
