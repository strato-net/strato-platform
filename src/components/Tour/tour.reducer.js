import { START_TOUR, ADD_STEPS_TO_TOUR } from './tour.actions';

const initialState = {
  run: true,
  steps: [],
};

const reducer = (state = initialState, action) => {
  switch(action.type) {
    case START_TOUR: {
      return Object.assign({}, state, {run: true});
    }
    case ADD_STEPS_TO_TOUR: {
      let steps = [...state.steps]
      steps = steps.concat(action.steps);
      return Object.assign({}, state, {steps});
    }
    default: {
      return state;
    }
  }
}

export default reducer;
