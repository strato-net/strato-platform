export const FETCH_ENTITY_REQUEST = 'FETCH_ENTITY_REQUEST';
export const FETCH_ENTITY_SUCCESS = 'FETCH_ENTITY_SUCCESS';
export const FETCH_ENTITY_FAILURE = 'FETCH_ENTITY_FAILURE';

export function fetchEntityRequest(id) {
  return {
    type: FETCH_ENTITY_REQUEST,
    id
  }
}

export function fetchEntitySuccess(entity) {
  return {
    type: FETCH_ENTITY_SUCCESS,
    entity
  }
}

export function fetchEntityFailure(error) {
  return {
    type: FETCH_ENTITY_FAILURE,
    error
  }
}