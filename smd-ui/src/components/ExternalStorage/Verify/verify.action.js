export const OPEN_VERIFY_MODAL = 'OPEN_VERIFY_MODAL';
export const CLOSE_VERIFY_MODAL = 'CLOSE_VERIFY_MODAL';
export const VERIFY_DOCUMENT_REQUEST = 'VERIFY_DOCUMENT_REQUEST';
export const VERIFY_DOCUMENT_SUCCESS = 'VERIFY_DOCUMENT_SUCCESS';
export const VERIFY_DOCUMENT_FAILURE = 'VERIFY_DOCUMENT_FAILURE';

export const openVerifyModal = function () {
  return {
    type: OPEN_VERIFY_MODAL
  }
}

export const closeVerifyModal = function () {
  return {
    type: CLOSE_VERIFY_MODAL
  }
}

export const verifyDocumentRequest = function (contractAddress) {
  return {
    type: VERIFY_DOCUMENT_REQUEST,
    contractAddress
  }
}

export const verifyDocumentSuccess = function (data) {
  return {
    type: VERIFY_DOCUMENT_SUCCESS,
    data
  }
}

export const verifyDocumentFailure = function (error) {
  return {
    type: VERIFY_DOCUMENT_FAILURE,
    error
  }
}