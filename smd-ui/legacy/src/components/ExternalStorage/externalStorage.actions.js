export const FETCH_UPLOAD_LIST = 'FETCH_UPLOAD_LIST';
export const FETCH_UPLOAD_LIST_SUCCESS = 'FETCH_UPLOAD_LIST_SUCCESS';
export const FETCH_UPLOAD_LIST_FAILURE = 'FETCH_UPLOAD_LIST_FAILURE';

export const fetchUploadList = function () {
  return {
    type: FETCH_UPLOAD_LIST
  }
}

export const fetchUploadSuccess = function (uploadList) {
  return {
    type: FETCH_UPLOAD_LIST_SUCCESS,
    uploadList
  }
}

export const fetchUploadFailure = function (error) {
  return {
    type: FETCH_UPLOAD_LIST_FAILURE,
    error
  }
}