export const FETCH_APPLICATIONS = 'FETCH_APPLICATIONS';
export const FETCH_APPLICATIONS_SUCCESSFUL = 'FETCH_APPLICATIONS_SUCCESSFUL';
export const FETCH_APPLICATIONS_FAILURE = 'FETCH_APPLICATIONS_FAILURE';
export const LAUNCH_APP = 'LAUNCH_APP';
export const LAUNCH_APP_SUCCESSFUL = 'LAUNCH_APP_SUCCESSFUL';
export const LAUNCH_APP_FAILURE = 'LAUNCH_APP_FAILURE';

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

export const launchApp = (url) => {
  return {
    type: LAUNCH_APP,
    url
  }
}

export const launchAppSuccess = (response, url) => {
  return {
    type: LAUNCH_APP_SUCCESSFUL,
    url
  }
}

export const launchAppFailure = (error) => {
  return {
    type: LAUNCH_APP_FAILURE,
    error
  }
}