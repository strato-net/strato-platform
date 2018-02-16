import {
  FETCH_APPLICATIONS_SUCCESSFUL,
  FETCH_APPLICATIONS_FAILURE,
  LAUNCH_APP_SUCCESSFUL,
  LAUNCH_APP_FAILURE,
  LAUNCH_APP,
  RESET_SELECTED_APP,
  SELECT_APP
} from './applications.actions';

const initialState = {
  applications: [],
  error: null,
  hash: null,
  selectedApp: null
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_APPLICATIONS_SUCCESSFUL:
      // only return unique apps
      const applications = action
        .applications
        .map((a) => {
          return {
            ...a,
            isLoading: false,
            url: `/apps/${a.hash}/`
          };
        });
      // .filter((app,i,v) => {
      //   return v.findIndex((a) => {
      //     return app.appName === a.appName
      //     && app.description === a.description
      //     && app.version === a.version
      //   }) === i
      // });
      return {
        ...state,
        applications: applications,
        error: null,
      };
    case FETCH_APPLICATIONS_FAILURE:
      return {
        ...state,
        applications: [],
        error: action.error,
      };
    case LAUNCH_APP:
      const newApplications = state.applications.map((app) => {
        if (app.address === action.address) {
          return {
            ...state,
            ...app,
            isLoading: true
          }
        }
        return {
          ...state,
          ...app
        }
      })
      return {
        ...state,
        applications: newApplications
      }
    case LAUNCH_APP_SUCCESSFUL:
      const updatedApplications = state.applications.map((app) => {
        if (app.address === action.address) {
          return {
            ...state,
            ...app,
            isLoading: false
          }
        }
        return {
          ...state,
          ...app
        }
      })
      return {
        ...state,
        applications: updatedApplications
      }
    case LAUNCH_APP_FAILURE:
      const updatedEApplications = state.applications.map((app) => {
        if (app.address === action.address) {
          return {
            ...state,
            ...app,
            isLoading: false
          }
        }
        return {
          ...state,
          ...app
        }
      })
      return {
        ...state,
        applications: updatedEApplications,
        error: action.error
      }
    case SELECT_APP:
      return {
        ...state,
        selectedApp: action.app
      }
    case RESET_SELECTED_APP:
      return {
        ...state,
        selectedApp: null
      }
    default:
      return state;

  }
};

export default reducer;
