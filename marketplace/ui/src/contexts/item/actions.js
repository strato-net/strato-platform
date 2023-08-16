import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  fetchItem: "fetch_items",
  fetchItemSuccessful: "fetch_item_successful",
  fetchItemFailed: "fetch_item_failed",
  retireItem: "retire_item",
  retireItemSuccessful: "retire_item_successful",
  retireItemFailed: "retire_item_failed",
  resetMessage: "reset_message",
  setMessage: "set_message",
  fetchSerialNumbers: "fetch_serial_numbers",
  fetchSerialNumbersSuccessful: "fetch_serial_numbers_success",
  fetchSerialNumbersFailed: "fetch_serial_numbers_failed",
  fetchItemOwnershipHistory: "fetch_item_ownership_history",
  fetchItemOwnershipHistorySuccessful: "fetch_item_ownership_history_successful",
  fetchItemOwnershipHistoryFailed: "fetch_item_ownership_history_failed",
  fetchItemRawMaterials: "fetch_item_raw_materials",
  fetchItemRawMaterialsSuccessful: "fetch_item_raw_materials_successful",
  fetchItemRawMaterialsFailed: "fetch_item_raw_materials_failed",
  setActualRawMaterials: "set_actual_raw_materials"
};

const actions = {
  resetMessage: (dispatch) => {
    dispatch({ type: actionDescriptors.resetMessage });
  },

  setMessage: (dispatch, message, success = false) => {
    dispatch({ type: actionDescriptors.setMessage, message, success });
  },

  setActualRawMaterials: (dispatch, payload) => {
    dispatch({
      type: actionDescriptors.setActualRawMaterials,
      payload: payload,
    });
  },

  fetchSerialNumbers: async (dispatch, id) => {
    dispatch({ type: actionDescriptors.fetchSerialNumbers });

    try {
      const response = await fetch(`${apiUrl}/item?inventoryId=${id}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchSerialNumbersSuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({
        type: actionDescriptors.fetchSerialNumbersFailed,
        error: "Error while fetching serial numbers",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchSerialNumbersFailed,
        error: "Error while fetching serial numbers",
      });
    }
  },

  fetchItemOwnershipHistory: async (dispatch, id) => {
    dispatch({ type: actionDescriptors.fetchItemOwnershipHistory });

    try {
      const response = await fetch(`${apiUrl}/item/ownership/${id}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchItemOwnershipHistorySuccessful,
          payload: body.data,
        });

        return true;
      }

      dispatch({
        type: actionDescriptors.fetchItemOwnershipHistoryFailed,
        error: "Error while fetching ownership history",
      });
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchItemOwnershipHistoryFailed,
        error: "Error while fetching ownership history",
      });
      return false;
    }
  },

  fetchItemRawMaterials: async (dispatch, itemUniqueProductCode, itemSerialNumber) => {

    dispatch({ type: actionDescriptors.fetchItemRawMaterials });

    try {
      const response = await fetch(
        `${apiUrl}/item/rawmaterials?itemUniqueProductCode=${itemUniqueProductCode}&itemSerialNumber=${itemSerialNumber}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchItemRawMaterialsSuccessful,
          payload: body.data,
        });
        return;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.fetchItemRawMaterialsFailed,
          error: "Error while fetching item raw materials"
        });
        return;
      }

      dispatch({ type: actionDescriptors.fetchItemRawMaterialsFailed, error: body.error });
    } catch (err) {
      dispatch({
        type: actionDescriptors.fetchItemRawMaterialsFailed,
        error: "Error while fetching item raw materials"
      });
    }
  },

  fetchItem: async (dispatch, limit, offset, queryValue) => {
    const query = queryValue ? `&inventoryId=${queryValue}` : "";

    dispatch({ type: actionDescriptors.fetchItem });

    try {
      const response = await fetch(
        `${apiUrl}/item?limit=${limit}&offset=${offset}${query}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchItemSuccessful,
          payload: body.data,
        });
        return;
      }
      dispatch({ type: actionDescriptors.fetchItemFailed, error: undefined });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchItemFailed, error: undefined });
    }
  },

  retireItem: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.retireItem });
    try {
      const response = await fetch(`${apiUrl}/item/retire`, {
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
          type: actionDescriptors.retireItemSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "Item retired successfully", true);
        return true;
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({
          type: actionDescriptors.retireItemFailed,
          error: "Error while retiring Item",
        });
        actions.setMessage(dispatch, "Error while retiring Item");
        return false;
      }

      dispatch({
        type: actionDescriptors.retireItemFailed,
        error: body.error,
      });
      actions.setMessage(dispatch, body.error);
      return false;
    } catch (err) {
      dispatch({
        type: actionDescriptors.retireItemFailed,
        error: "Error while retiring Item",
      });
      actions.setMessage(dispatch, "Error while retiring Item");
    }
  },
};

export { actionDescriptors, actions };
