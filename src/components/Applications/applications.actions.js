export const FETCH_APPLICATIONS = 'FETCH_APPLICATIONS';
export const FETCH_APPLICATIONS_SUCCESSFUL = 'FETCH_APPLICATIONS_SUCCESSFUL';
export const FETCH_APPLICATIONS_FAILURE = 'FETCH_APPLICATIONS_FAILURE';

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