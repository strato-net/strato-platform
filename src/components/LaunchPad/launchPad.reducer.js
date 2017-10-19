import {
  APP_USERNAME_CHANGE,
  LAUNCHPAD_LOAD,
  APP_UPLOAD_SUCCESS,
  APP_UPLOAD_FAILURE,
  APP_RESET
} from './launchPad.actions';

const initialState = {
  firstLoad: true,
  username: '',
  error: '',
  appPackage: null,
  requestCompleted: false
}

const reducer = function(state=initialState, action) {
  switch(action.type) {
    case LAUNCHPAD_LOAD:
      return {
        ...state,
        firstLoad: false
      }
    case APP_USERNAME_CHANGE:
      return {
        ...state,
        username: action.name
      };
    case APP_UPLOAD_SUCCESS:
      return {
        ...state,
        requestCompleted: true,
        error: ''
      }
    case APP_UPLOAD_FAILURE:
      return {
        ...state,
        error: action.error.message
      }
    case APP_RESET:
      return initialState;
    default:
      return state;
  }
}

export default reducer;
