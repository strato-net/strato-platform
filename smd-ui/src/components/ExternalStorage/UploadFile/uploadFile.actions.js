export const OPEN_UPLOAD_MODAL = 'OPEN_UPLOAD_MODAL';
export const CLOSE_UPLOAD_MODAL = 'CLOSE_UPLOAD_MODAL';
export const UPLOAD_FILE_REQUEST = 'UPLOAD_FILE_REQUEST';
export const UPLOAD_FILE_SUCCESS = 'UPLOAD_FILE_SUCCESS';
export const UPLOAD_FILE_FAILURE = 'UPLOAD_FILE_FAILURE';

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

export const uploadFileSuccess = function (data) {
  return {
    type: UPLOAD_FILE_SUCCESS,
    data
  }
}

export const uploadFileFailure = function (error) {
  return {
    type: UPLOAD_FILE_FAILURE,
    error
  }
}