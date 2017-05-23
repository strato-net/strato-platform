export const FETCH_DIFFICULTY = 'FETCH_DIFFICULTY';
export const FETCH_DIFFICULTY_SUCCESS = 'FETCH_DIFFICULTY_SUCCESS';
export const FETCH_DIFFICULTY_FAILURE = 'FETCH_DIFFICULTY_FAILURE';

export const fetchDifficulty = function () {
  return {
    type: FETCH_DIFFICULTY,
  }
};

export const fetchDifficultySuccess = function (difficulty) {
  return {
    type: FETCH_DIFFICULTY_SUCCESS,
    difficulty: difficulty
  }
};

export const fetchDifficultyFailure = function (error) {
  return {
    type: FETCH_DIFFICULTY_FAILURE,
    error: error,
  }
};
