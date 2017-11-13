import {
  FETCH_APPLICATIONS_SUCCESSFUL,
  FETCH_APPLICATIONS_FAILURE,
  LAUNCH_APP_SUCCESSFUL,
  LAUNCH_APP_FAILURE,
  LAUNCH_APP
} from './applications.actions';

const initialState = {
  applications: [],
  error: null,
  hash: null
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
        applications: applications,
        error: null,
      };
    case FETCH_APPLICATIONS_FAILURE:
      return {
        applications: [],
        error: action.error,
      };
    case LAUNCH_APP:
      const newApplications = state.applications.map((app) => {
        if(app.address === action.address) {
          return {
            ...app,
            isLoading: true
          }
        }
        return {
          ...app
        }
      })
      return {
        ...state,
        applications: newApplications
      }
    case LAUNCH_APP_SUCCESSFUL:
      const updatedApplications = state.applications.map((app) => {
        if(app.address === action.address) {
          return {
            ...app,
            isLoading: false
          }
        }
        return {
          ...app
        }
      })
      return {
        ...state,
        applications: updatedApplications
      }
    case LAUNCH_APP_FAILURE:
      const updatedEApplications = state.applications.map((app) => {
        if(app.address === action.address) {
          return {
            ...app,
            isLoading: false
          }
        }
        return {
          ...app
        }
      })
      return {
        ...state,
        applications: updatedEApplications,
        error: action.error
      }
    default:
      return state;

  }
};

export default reducer;
