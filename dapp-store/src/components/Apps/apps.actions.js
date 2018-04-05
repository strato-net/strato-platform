export const FETCH_APPS = 'FETCH_APPS';
export const FETCH_APPS_SUCCESSFUL = 'FETCH_APPS_SUCCESSFUL';
export const FETCH_APPS_FAILURE = 'FETCH_APPS_FAILURE';
export const SELECT_APP = "SELECT_APP"

export const fetchApps = () => {
  return {
    type: FETCH_APPS,
  }
}

export const fetchAppsSuccess = (response) => {
  return {
    type: FETCH_APPS_SUCCESSFUL,
    applications: response
  }
}

export const fetchAppsFailure = (error) => {
  return {
    type: FETCH_APPS_FAILURE,
    error
  }
}

export const selectApp = (app) => {
  return {
    type: SELECT_APP,
    app
  }
}