import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
    createCarbon: "create_carbon",
    createCarbonSuccessful: "create_carbon_successful",
    createCarbonFailed: "create_carbon_failed",
    fetchCarbons: "fetch_carbons",
    fetchCarbonsSuccessful: "fetch_carbons_successful",
    fetchCarbonsFailed: "fetch_carbons_failed",
    fetchCarbonDetails: "fetch_carbon_details",
    fetchCarbonDetailsSuccessful: "fetch_carbon_details_successful",
    fetchCarbonDetailsFailed: "fetch_carbon_details_failed",
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

    createCarbon: async (dispatch, payload) => {
        dispatch({ type: actionDescriptors.createCarbon });
        try {
            const response = await fetch(`${apiUrl}/carbon`, {
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
                    type: actionDescriptors.createCarbonSuccessful,
                    payload: body.data,
                    success: true
                });
                actions.setMessage(dispatch, "Carbon created successfully", true);
                return true;
            } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
                dispatch({
                    type: actionDescriptors.createCarbonFailed,
                    error: "Error while creating carbon",
                });
                actions.setMessage(dispatch, "Error while creating carbon");
                return false;
            }

            dispatch({
                type: actionDescriptors.createCarbonFailed,
                error: body.error,
            });
            actions.setMessage(dispatch, body.error);
            return false;
        } catch (err) {
            dispatch({
                type: actionDescriptors.createCarbonFailed,
                error: "Error while creating carbon",
            });
            actions.setMessage(dispatch, "Error while creating carbon");
        }
    },
    fetchCarbons: async (dispatch, limit, offset, queryValue) => {
        const query = queryValue
            ? `&queryValue=${queryValue}&queryFields=name`
            : "";

        dispatch({ type: actionDescriptors.fetchCarbons });
        try {
            const response = await fetch(
                `${apiUrl}/carbon?limit=${limit}&offset=${offset}${query}`,
                {
                    method: HTTP_METHODS.GET,
                }
            );

            const body = await response.json();

            if (response.status === RestStatus.OK) {
                dispatch({
                    type: actionDescriptors.fetchCarbonsSuccessful,
                    payload: body.data,
                });
                return;
            } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
                dispatch({
                    type: actionDescriptors.fetchCarbonsFailed,
                    error: "Error while fetching carbons",
                });
            }
            dispatch({
                type: actionDescriptors.fetchCarbonsFailed,
                error: "Error while fetching carbons",
            });
        } catch (err) {
            dispatch({
                type: actionDescriptors.fetchCarbonsFailed,
                error: "Error while fetching carbons",
            });
        }
    },
    fetchCarbonDetails: async (dispatch, id) => {
        dispatch({ type: actionDescriptors.fetchCarbonDetails })
        try {
            const response = await fetch(`${apiUrl}/carbon/${id}`,
                {
                    method: HTTP_METHODS.GET,
                }
            );

            const body = await response.json();

            if (response.status === RestStatus.OK) {
                dispatch({
                    type: actionDescriptors.fetchCarbonDetailsSuccessful,
                    payload: body.data,
                });
                return;
            } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
                dispatch({
                    type: actionDescriptors.fetchCarbonDetailsFailed,
                    error: "Error while fetching carbon",
                });
                return;
            }
            dispatch({
                type: actionDescriptors.fetchCarbonDetailsFailed,
                error: body.error,
            });
            return;
        } catch (err) {
            dispatch({
                type: actionDescriptors.fetchCarbonDetailsFailed,
                error: "Error while fetching carbon",
            });

        }
    },
}

export { actions, actionDescriptors }