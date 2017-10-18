export const APP_USERNAME_CHANGE = 'APP_USERNAME_CHANGE';
export const LAUNCHPAD_LOAD = 'LAUNCHPAD_LOAD'
export const APP_UPLOAD_REQUEST = 'APP_UPLOAD_REQUEST';
export const APP_UPLOAD_SUCCESS = 'APP_UPLOAD_SUCCESS';
export const APP_UPLOAD_FAILURE = 'APP_UPLOAD_FAILURE';

export const loadLaunchPad =   function() {
  return {
    type: LAUNCHPAD_LOAD
  }
}

export const usernameChange = function(name) {
  return {
    type: APP_USERNAME_CHANGE,
    name:  name
  }
}

export const appUploadRequest = function(formData) {
  return {
    type: APP_UPLOAD_REQUEST,
    formData: formData
  }
}

export const appUploadSuccess = function() {
  return {
    type: APP_UPLOAD_SUCCESS
  }
}

export const appUploadFailure = function(error) {
  return {
    type: APP_UPLOAD_FAILURE,
    error: error
  }
}
