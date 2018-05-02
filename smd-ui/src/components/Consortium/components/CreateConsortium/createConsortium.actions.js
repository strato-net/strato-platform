export const ADD_CONSORTIUM_INFORMATION = "ADD_CONSORTIUM_INFORMATION";
export const ADD_ENTITY = "ADD_ENTITY";

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
