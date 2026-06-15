export const OPEN_DOWNLOAD_MODAL = 'OPEN_DOWNLOAD_MODAL';
export const CLOSE_DOWNLOAD_MODAL = 'CLOSE_DOWNLOAD_MODAL';
export const DOWNLOAD_REQUEST = 'DOWNLOAD_REQUEST';
export const DOWNLOAD_SUCCESS = 'DOWNLOAD_SUCCESS';
export const DOWNLOAD_FAILURE = 'DOWNLOAD_FAILURE';
export const RESET_ERROR = 'RESET_ERROR';
export const CLEAR_URL = 'CLEAR_URL';

export const openDownloadModal = function () {
  return {
    type: OPEN_DOWNLOAD_MODAL
  }
}

export const closeDownloadModal = function () {
  return {
    type: CLOSE_DOWNLOAD_MODAL
  }
}

export const downloadRequest = function (contractAddress) {
  return {
    type: DOWNLOAD_REQUEST,
    contractAddress
  }
}

export const downloadSuccess = function (url) {
  return {
    type: DOWNLOAD_SUCCESS,
    url: url
  }
}

export const downloadFailure = function (error) {
  return {
    type: DOWNLOAD_FAILURE,
    error
  }
}

export const resetError = function () {
  return {
    type: RESET_ERROR
  }
}

export const clearUrl = function () {
  return {
    type: CLEAR_URL
  }
}