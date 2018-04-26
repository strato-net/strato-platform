export const OPEN_OVERLAY = "OPEN_MODAL";
export const CLOSE_OVERLAY = "CLOSE_MODAL";
export const CREATE_BLOC_USER_REQUEST = "CREATE_BLOC_USER_REQUEST";
export const CREATE_BLOC_USER_SUCCESS = "CREATE_BLOC_USER_SUCCESS";
export const CREATE_BLOC_USER_FAILURE = "CREATE_BLOC_USER_FAILURE";

export const openOverlay = function () {
  return {
    type: OPEN_OVERLAY,
    isOpen: true
  }
}

export const closeOverlay = function () {
  return {
    type: CLOSE_OVERLAY,
    isOpen: false
  }
}

export const createBlocUser = function (username, password) {
  return {
    type: CREATE_BLOC_USER_REQUEST,
    username,
    password,
    spinning: true,
    isOpen: true,
  }
}

export const createBlocUserSuccess = function (key) {
  return {
    type: CREATE_BLOC_USER_SUCCESS,
    key: key,
    spinning: false,
    isOpen: false,
  }
}

export const createBlocUserFailure = function (error) {
  return {
    type: CREATE_BLOC_USER_FAILURE,
    error: error,
    spinning: false,
    isOpen: false,
  }
}