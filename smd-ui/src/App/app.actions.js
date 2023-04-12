export const GET_HEALTH_REQUEST = 'GET_HEALTH_REQUEST';
export const GET_HEALTH_SUCCESS = 'GET_HEALTH_SUCCESS';
export const GET_HEALTH_FAILURE = 'GET_HEALTH_FAILURE';
export const GET_METADATA_REQUEST = 'GET_METADATA_REQUEST';
export const GET_METADATA_SUCCESS = 'GET_METADATA_SUCCESS';
export const GET_METADATA_FAILURE = 'GET_METADATA_FAILURE';

export const fetchHealth = function () {
    return {
      type: GET_HEALTH_REQUEST,
    }
};
  
export const fetchHealthSuccess = function (health) {
    return {
        type: GET_HEALTH_SUCCESS,
        health: health,
    }
};

export const fetchHealthFailure = function (error) {
    return {
        type: GET_HEALTH_FAILURE,
        error: error,
    }
};
export const fetchMetadata = function () {
    return {
      type: GET_METADATA_REQUEST,
    }
};
  
export const fetchMetadataSuccess = function ({metadata, nodeInfo}) {
    return {
        type: GET_METADATA_SUCCESS,
        metadata: metadata,
        nodeInfo,
    }
};

export const fetchMetadataFailure = function (error) {
    return {
        type: GET_METADATA_FAILURE,
        error: error,
    }
};
