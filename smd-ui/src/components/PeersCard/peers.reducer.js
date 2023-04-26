import {
    GET_PEER_IDENTITY_REQUEST,
    GET_PEER_IDENTITY_SUCCESS,
    GET_PEER_IDENTITY_FAILURE,
} from './peers.actions'

const initialState = {
    loading: false,
    ids: undefined,
    error: undefined,
}

const reducer = (state = initialState, action) => {
    switch (action.type) {
        case GET_PEER_IDENTITY_REQUEST:
            return {
                ...state,
                loading: true,
                error: undefined,
            }
        case GET_PEER_IDENTITY_SUCCESS:
            const idsMap = action.data.reduce((prev, cur) => {
                return {
                    ...prev,
                    [cur.userAddress]: cur
                }
            }, {})
            return {
                ...state,
                loading: false,
                ids: idsMap,
                error: undefined,
            }
        case GET_PEER_IDENTITY_FAILURE:
            return {
                ...state,
                loading: false,
                error: action.data,
            }
        default :
            return state
    }
}

export default reducer