export const OPEN_ATTEST_MODAL = 'OPEN_ATTEST_MODAL';
export const CLOSE_ATTEST_MODAL = 'CLOSE_ATTEST_MODAL';
export const ATTEST_DOCUMENT_REQUEST = 'ATTEST_DOCUMENT_REQUEST';
export const ATTEST_DOCUMENT_SUCCESS = 'ATTEST_DOCUMENT_SUCCESS';
export const ATTEST_DOCUMENT_FAILURE = 'ATTEST_DOCUMENT_FAILURE';
export const USERNAME_FORM_CHANGE = 'USERNAME_FORM_CHANGE';
export const RESET_ERROR = 'RESET_ERROR';

export const openAttestModal = function () {
  return {
    type: OPEN_ATTEST_MODAL
  }
}

export const closeAttestModal = function () {
  return {
    type: CLOSE_ATTEST_MODAL
  }
}

export const attestDocument = function (values) {
  return {
    type: ATTEST_DOCUMENT_REQUEST,
    values
  }
}

export const attestDocumentSuccess = function (data) {
  return {
    type: ATTEST_DOCUMENT_SUCCESS,
    data
  }
}

export const attestDocumentFailure = function (error) {
  return {
    type: ATTEST_DOCUMENT_FAILURE,
    error
  }
}

export const changeUsername = function (username) {
  return {
    type: USERNAME_FORM_CHANGE,
    username
  }
}

export const resetError = function () {
  return {
    type: RESET_ERROR
  }
}
