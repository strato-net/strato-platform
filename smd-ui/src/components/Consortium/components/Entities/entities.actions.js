export const OPEN_INVITE_ENTITY_MODAL = "OPEN_INVITE_ENTITY_MODAL";
export const CLOSE_INVITE_ENTITY_MODAL = "CLOSE_INVITE_ENTITY_MODAL";
export const OPEN_REQUEST_REMOVAL_MODAL = "OPEN_REQUEST_REMOVAL_MODAL";
export const CLOSE_REQUEST_REMOVAL_MODAL = "CLOSE_REQUEST_REMOVAL_MODAL";
export const FETCH_ENTITES_REQUEST = "FETCH_ENTITES_REQUEST";
export const FETCH_ENTITES_SUCCESS = "FETCH_ENTITES_SUCCESS";
export const FETCH_ENTITES_FAILURE = "FETCH_ENTITES_FAILURE";
export const INVITE_ENTITY_REQUEST = "INVITE_ENTITY_REQUEST";
export const INVITE_ENTITY_SUCCESS = "INVITE_ENTITY_SUCCESS";
export const INVITE_ENTITY_FAILURE = "INVITE_ENTITY_FAILURE";
export const VOTE_REQUEST = "VOTE_REQUEST";
export const VOTE_SUCCESS = "VOTE_SUCCESS";
export const VOTE_FAILURE = "VOTE_FAILURE";
export const RESET_ERROR = "RESET_ERROR";

export function openInviteEntityModal() {
  return {
    type: OPEN_INVITE_ENTITY_MODAL
  };
}

export function closeInviteEntityModal() {
  return {
    type: CLOSE_INVITE_ENTITY_MODAL
  };
}

export function openRequestRemovalModal() {
  return {
    type: OPEN_REQUEST_REMOVAL_MODAL
  };
}

export function closeRequestRemovalModal() {
  return {
    type: CLOSE_REQUEST_REMOVAL_MODAL
  };
}

export function vote(data) {
  return {
    type: VOTE_REQUEST,
    data
  }
}

export function voteSuccess(response) {
  return {
    type: VOTE_SUCCESS,
    response
  }
}

export function voteFailure(error) {
  return {
    type: VOTE_FAILURE,
    error
  }
}

export function fetchEntities() {
  return {
    type: FETCH_ENTITES_REQUEST
  };
}

export function fetchEntitiesSuccess(entities) {
  return {
    type: FETCH_ENTITES_SUCCESS,
    entities
  };
}

export function fetchEntitiesFailure(error) {
  return {
    type: FETCH_ENTITES_FAILURE,
    error
  };
}

export const inviteEntityRequest = function (entity) {
  return {
    type: INVITE_ENTITY_REQUEST,
    entity,
  }
}

export const inviteEntitySuccess = function (isEntityCreated) {
  return {
    type: INVITE_ENTITY_SUCCESS,
    isEntityCreated
  }
}

export const inviteEntityFailure = function (error) {
  return {
    type: INVITE_ENTITY_FAILURE,
    error,
  }
}

export const resetError = function () {
  return {
    type: RESET_ERROR
  }
}