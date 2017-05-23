import {
  FETCH_DIFFICULTY,
  FETCH_DIFFICULTY_SUCCESS,
  FETCH_DIFFICULTY_FAILURE,
} from './difficulty.actions';

const initialState = {
  difficulty: -1,
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_DIFFICULTY:
      return {
        difficulty: state.difficulty,
        error: null,
      };
    case FETCH_DIFFICULTY_SUCCESS:
      return {
        difficulty: action.difficulty,
        error: null,
      };
    case FETCH_DIFFICULTY_FAILURE:
      return {
        difficulty: state.difficulty,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;
