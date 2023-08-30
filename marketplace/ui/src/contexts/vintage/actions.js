import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const actionDescriptors = {
    createVintage: "create_vintage",
    createVintageSuccessful: "create_vintage_successful",
    createVintageFailed: "create_vintage_failed",
    fetchVintages: "fetch_vintages",
    fetchVintagesSuccessful: "fetch_vintages_successful",
    fetchVintagesFailed: "fetch_vintages_failed",
    fetchVintageDetails: "fetch_vintage_details",
    fetchVintageDetailsSuccessful: "fetch_vintage_details_successful",
    fetchVintageDetailsFailed: "fetch_vintage_details_failed",
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

    createVintage: async (dispatch, payload) => {
        dispatch({ type: actionDescriptors.createVintage });
        try {
            const response = await fetch(`${apiUrl}/vintage`, {
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
                    type: actionDescriptors.createVintageSuccessful,
                    payload: body.data,
                    success: true
                });
                actions.setMessage(dispatch, "Vintage created successfully", true);
                return true;
            } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
                dispatch({
                    type: actionDescriptors.createVintageFailed,
                    error: "Error while creating vintage",
                });
                actions.setMessage(dispatch, "Error while creating vintage");
                return false;
            }

            dispatch({
                type: actionDescriptors.createVintageFailed,
                error: body.error,
            });
            actions.setMessage(dispatch, body.error);
            return false;
        } catch (err) {
            dispatch({
                type: actionDescriptors.createVintageFailed,
                error: "Error while creating vintage",
            });
            actions.setMessage(dispatch, "Error while creating vintage");
        }
    },
    fetchVintages: async (dispatch, limit, offset, queryValue) => {
        const query = queryValue
            ? `&queryValue=${queryValue}&queryFields=name`
            : "";

        dispatch({ type: actionDescriptors.fetchVintages });
        try {
            const response = await fetch(
                `${apiUrl}/vintage?limit=${limit}&offset=${offset}${query}`,
                {
                    method: HTTP_METHODS.GET,
                }
            );

            const body = await response.json();

            if (response.status === RestStatus.OK) {
                dispatch({
                    type: actionDescriptors.fetchVintagesSuccessful,
                    payload: body.data,
                });
                return;
            } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
                dispatch({
                    type: actionDescriptors.fetchVintagesFailed,
                    error: "Error while fetching vintages",
                });
            }
            dispatch({
                type: actionDescriptors.fetchVintagesFailed,
                error: "Error while fetching vintages",
            });
        } catch (err) {
            dispatch({
                type: actionDescriptors.fetchVintagesFailed,
                error: "Error while fetching vintages",
            });
        }
    },
    fetchVintageDetails: async (dispatch, id) => {
        dispatch({ type: actionDescriptors.fetchVintageDetails })
        try {
            const response = await fetch(`${apiUrl}/vintage/${id}`,
                {
                    method: HTTP_METHODS.GET,
                }
            );

            const body = await response.json();

            if (response.status === RestStatus.OK) {
                dispatch({
                    type: actionDescriptors.fetchVintageDetailsSuccessful,
                    payload: body.data,
                });
                return;
            } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
                dispatch({
                    type: actionDescriptors.fetchVintageDetailsFailed,
                    error: "Error while fetching vintage",
                });
                return;
            }
            dispatch({
                type: actionDescriptors.fetchVintageDetailsFailed,
                error: body.error,
            });
            return;
        } catch (err) {
            dispatch({
                type: actionDescriptors.fetchVintageDetailsFailed,
                error: "Error while fetching vintage",
            });

        }
    },
}

export { actions, actionDescriptors }