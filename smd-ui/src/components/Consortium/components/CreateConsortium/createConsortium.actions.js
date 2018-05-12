export const ADD_CONSORTIUM_INFORMATION = "ADD_CONSORTIUM_INFORMATION";
export const ADD_ENTITY = "ADD_ENTITY";
export const CREATE_CONSORTIUM_REQUEST = "CREATE_CONSORTIUM_REQUEST";
export const CREATE_CONSORTIUM_SUCCESS = "CREATE_CONSORTIUM_SUCCESS";
export const CREATE_CONSORTIUM_FAILURE = "CREATE_CONSORTIUM_FAILURE";

export const addConsortiumInformation = function ({ networkId, addEntityRules, removeEntityRules }) {
  return {
    type: ADD_CONSORTIUM_INFORMATION,
    id: networkId,
    addEntityRules,
    removeEntityRules,
  }
}

export const addEntity = function (entity) {
  return {
    type: ADD_ENTITY,
    entity,
  }
}

export const createConsortiumRequest = function (consortium) {
  return {
    type: CREATE_CONSORTIUM_REQUEST,
    consortium,
  }
}

export const createConsortiumSuccess = function (consortium) {
  return {
    type: CREATE_CONSORTIUM_SUCCESS,
    consortium,
  }
}

export const createConsortiumFailure = function (error) {
  return {
    type: CREATE_CONSORTIUM_FAILURE,
    error,
  }
}
