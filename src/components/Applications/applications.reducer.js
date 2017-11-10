import {
  FETCH_APPLICATIONS_SUCCESSFUL,
  FETCH_APPLICATIONS_FAILURE,
  LAUNCH_APP_SUCCESSFUL,
  LAUNCH_APP_FAILURE,
  LAUNCH_APP
} from './applications.actions';

const initialState = {
  applcations: [],
  error: null,
  isLoading: false,
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
            address: undefined,
            url: a.url + '/ui'
          };
         })
        .filter((app,i,v) => {
          return v.findIndex((a) => {
            return app.appName === a.appName
            && app.description === a.description
            && app.version === a.version
          }) === i
        });
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
      return {
        ...state,
        url: action.url,
        isLoading: true
      }
    case LAUNCH_APP_SUCCESSFUL: 
      return {
        ...state,
        isLoading: false,
        url: action.url
      }
    case LAUNCH_APP_FAILURE: 
      return {
        ...state,
        isLoading: false,
        error: action.error
      }
    default:
      return state;

  }
};

export default reducer;
