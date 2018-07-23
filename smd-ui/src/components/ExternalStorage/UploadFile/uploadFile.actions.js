export const OPEN_UPLOAD_MODAL = 'OPEN_UPLOAD_MODAL';
export const CLOSE_UPLOAD_MODAL = 'CLOSE_UPLOAD_MODAL';
export const UPLOAD_FILE_REQUEST = 'UPLOAD_FILE_REQUEST';
export const UPLOAD_FILE_SUCCESS = 'UPLOAD_FILE_SUCCESS';
export const UPLOAD_FILE_FAILURE = 'UPLOAD_FILE_FAILURE';
export const RESET_UPLOAD_ERROR = 'RESET_UPLOAD_ERROR';
export const USERNAME_FORM_CHANGE = 'USERNAME_FORM_CHANGE';

export const openUploadModal = function () {
  return {
    type: OPEN_UPLOAD_MODAL
  }
}

export const closeUploadModal = function () {
  return {
    type: CLOSE_UPLOAD_MODAL
  }
}

export const uploadFileRequest = function (data) {
  return {
    type: UPLOAD_FILE_REQUEST,
    data
  }
}

export const uploadFileSuccess = function (result) {
  return {
    type: UPLOAD_FILE_SUCCESS,
    result
  }
}

export const uploadFileFailure = function (error) {
  return {
    type: UPLOAD_FILE_FAILURE,
    error
  }
}

export const resetError = function () {
  return {
    type: RESET_UPLOAD_ERROR
  }
}

export const changeUsername = function(name) {
  return {
    type: USERNAME_FORM_CHANGE,
    name: name
  }
}