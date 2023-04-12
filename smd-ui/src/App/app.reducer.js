import {
    GET_HEALTH_REQUEST,
    GET_HEALTH_SUCCESS,
    GET_HEALTH_FAILURE,
    GET_METADATA_REQUEST,
    GET_METADATA_SUCCESS,
    GET_METADATA_FAILURE,
} from "./app.actions"

const initialState = {
    error: undefined,
    loading: false,
    health: undefined,
    metadata: undefined,
    nodeInfo: undefined,
}

const reducer = function (state = initialState, action) {
    switch (action.type) {
        case GET_HEALTH_REQUEST:
            return {
                ...state,
                error: undefined,
                loading: true,
            }
        case GET_HEALTH_SUCCESS:
            return {
                ...state,
                error: undefined,
                loading: false,
                health: action.health
            }
        case GET_HEALTH_FAILURE:
            return {
                ...state,
                error: action.error,
                loading: false,
            }
        case GET_METADATA_REQUEST:
            return {
                ...state,
                error: undefined,
                loading: true,
            }
        case GET_METADATA_SUCCESS:
            return {
                ...state,
                error: undefined,
                loading: false,
                metadata: action.metadata,
                nodeInfo: action.nodeInfo
            }
        case GET_METADATA_FAILURE:
            return {
                ...state,
                error: action.error,
                loading: false,
            }
        default:
            return state
    }
}

export default reducer;