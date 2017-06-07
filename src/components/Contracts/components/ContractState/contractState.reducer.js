import {
  FETCH_STATE,
  FETCH_STATE_SUCCESS,
  FETCH_STATE_FAILURE,
} from './contractState.actions';

const initialState = {
  states: {},
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_STATE:
      return {
        states: state.states,
        error: null,
      };
    case FETCH_STATE_SUCCESS:
      return {
        states: {
          ...state.states,
          [action.address]: action.state
      },
        error: null,
      };
    case FETCH_STATE_FAILURE:
      return {
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;
