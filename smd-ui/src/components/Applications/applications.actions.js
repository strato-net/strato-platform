export const FETCH_APPLICATIONS = 'FETCH_APPLICATIONS';
export const FETCH_APPLICATIONS_SUCCESSFUL = 'FETCH_APPLICATIONS_SUCCESSFUL';
export const FETCH_APPLICATIONS_FAILURE = 'FETCH_APPLICATIONS_FAILURE';
export const LAUNCH_APP = 'LAUNCH_APP';
export const LAUNCH_APP_SUCCESSFUL = 'LAUNCH_APP_SUCCESSFUL';
export const LAUNCH_APP_FAILURE = 'LAUNCH_APP_FAILURE';
export const SELECT_APP = 'SELECT_APP'
export const RESET_SELECTED_APP = 'RESET_SELECTED_APP'

export const fetchApplications = () => {
  return {
    type: FETCH_APPLICATIONS,
  }
}

export const fetchApplicationsSuccess = (response) => {
  return {
    type: FETCH_APPLICATIONS_SUCCESSFUL,
    applications: response
  }
}

export const fetchApplicationsFailure = (error) => {
  return {
    type: FETCH_APPLICATIONS_FAILURE,
    error
  }
}

export const launchApp = (address, url) => {
  return {
    type: LAUNCH_APP,
    address,
    url
  }
}

export const launchAppSuccess = (response, address) => {
  return {
    type: LAUNCH_APP_SUCCESSFUL,
    address: address
  }
}

export const launchAppFailure = (error) => {
  return {
    type: LAUNCH_APP_FAILURE,
    error
  }
}

export const selectApp = (app) => {
  return {
    type: SELECT_APP,
    app
  }
}

export const resetSelectedApp = () => {
  return {
    type: RESET_SELECTED_APP,
  }
}