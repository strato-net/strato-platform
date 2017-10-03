import { TOGGLE_DASHBOARD_TOUR, ADD_STEPS_TO_TOUR } from './dashboard.actions';

const initialState = {
  tour: {
    running: false,
    steps: [],
  }
};

const reducer = (state = initialState, action) => {
  switch(action.type) {
    case TOGGLE_DASHBOARD_TOUR: {
      const tour = {tour: Object.assign({}, state.tour, {running: !state.tour.running})};
      return Object.assign({}, state, tour);
    }
    case ADD_STEPS_TO_TOUR: {
      let steps = [...state.tour.steps]
      steps = steps.concat(action.steps);
      const tour = {tour: Object.assign({}, state.tour, {steps})}
      return Object.assign({}, state, tour);
    }
    default: {
      return state;
    }
  }
}

export default reducer;
