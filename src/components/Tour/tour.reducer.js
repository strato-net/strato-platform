import { END_TOUR } from './tour.actions';

const initialState = {
  dashboard: {run: true},
  transactions: {run: true},
  accounts: {run: true},
  contracts: {run: true},
  steps: [],
};

const reducer = (state = initialState, action) => {
  switch(action.type) {
    case END_TOUR: {
      return Object.assign({}, state, {[action.name]: Object.assign({}, state[action.name], {run: false})});
    }
    default: {
      return state;
    }
  }
}

export default reducer;
