export const GET_PEER_IDENTITY_REQUEST = 'GET_PEER_IDENTITY_REQUEST'
export const GET_PEER_IDENTITY_SUCCESS = 'GET_PEER_IDENTITY_SUCCESS'
export const GET_PEER_IDENTITY_FAILURE = 'GET_PEER_IDENTITY_FAILURE'

export const getPeerIdentityRequest = (peers) => {
    return {
        type: GET_PEER_IDENTITY_REQUEST,
        data: peers,
    }
}
export const getPeerIdentitySuccess = (ids) => {
    return {
        type: GET_PEER_IDENTITY_SUCCESS,
        data: ids,
    }
}
export const getPeerIdentityFailure = (error) => {
    return {
        type: GET_PEER_IDENTITY_FAILURE,
        data: error,
    }
}