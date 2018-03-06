import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY,
} from './tokenRequest.actions';

const initialState = {
  isTokenOpen: false,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_OVERLAY:
      return {
        isTokenOpen: true,
      };
    case CLOSE_OVERLAY:
      return {
        isTokenOpen: false
      };
    default:
      return state;
  }
};

export default reducer;