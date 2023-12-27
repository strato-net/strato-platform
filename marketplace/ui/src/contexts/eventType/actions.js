import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
  createEventType: "create_eventType",
  createEventTypeSuccessful: "create_eventType_successful",
  createEventTypeFailed: "create_eventType_failed",
  fetchEventType: "fetch_eventTypes",
  fetchEventTypeSuccessful: "fetch_eventType_successful",
  fetchEventTypeFailed: "fetch_eventType_failed",
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

  createEventType: async (dispatch, payload) => {
    dispatch({ type: actionDescriptors.createEventType });

    try {
      const response = await fetch(`${apiUrl}/eventType`, {
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
          type: actionDescriptors.createEventTypeSuccessful,
          payload: body.data,
        });
        actions.setMessage(dispatch, "EventType created successfully", true)
        return true;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR){
        dispatch({ type: actionDescriptors.createEventTypeFailed, error: "Error while creating Event Type" });
        actions.setMessage(dispatch, "Error while creating Event Type")
        return false;
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.createEventTypeFailed, 
          error: "Unauthorized while creating Event Type" 
        });
        window.location.href = body.error.loginUrl;
      }

      dispatch({ type: actionDescriptors.createEventTypeFailed, error: body.error });
      actions.setMessage(dispatch, body.error)
      return false;

    } catch (err) {
      dispatch({ type: actionDescriptors.createEventTypeFailed,  error: "Error while creating Event Type"  });
      actions.setMessage(dispatch, "Error while creating Event Type")
    }
  },

  fetchEventType: async (dispatch, limit, offset, queryValue) => {
      const query = queryValue
      ? `&queryValue=${queryValue}&queryFields=name`
      : "";
      
    dispatch({ type: actionDescriptors.fetchEventType });

    try {
      const response = await fetch(`${apiUrl}/eventType?limit=${limit}&offset=${offset}${query}`, {
        method: HTTP_METHODS.GET,
      });

      const body = await response.json();

      if (response.status === RestStatus.OK) {
        dispatch({
          type: actionDescriptors.fetchEventTypeSuccessful,
          payload: body.data,
        });
        return;
      } else if(response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        dispatch({ type: actionDescriptors.fetchEventTypeFailed, error: "Error while fetching Event Type" });
      } else if(response.status === RestStatus.UNAUTHORIZED) {
        dispatch({ 
          type: actionDescriptors.fetchEventTypeFailed, 
          error: "Unauthorized while fetching Event Type" 
        });
        window.location.href = body.error.loginUrl;
      }
      dispatch({ type: actionDescriptors.fetchEventTypeFailed, error: body.error });
    } catch (err) {
      dispatch({ type: actionDescriptors.fetchEventTypeFailed, error: "Error while fetching Event Type" });
    }
  }
};

export { actionDescriptors, actions };
