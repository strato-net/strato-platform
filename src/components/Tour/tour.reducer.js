import { END_TOUR, END_ALL_TOURS, STOP_TOUR_AUTOSTART, STOP_ALL_TOUR_AUTOSTARTS } from './tour.actions';

const initialState = {
  dashboard: {run: true, autoStart: true},
  transactions: {run: true, autoStart: true},
  accounts: {run: true, autoStart: true},
  contracts: {run: true, autoStart: true},
  all: {run: true, autoStart: true},
};

const reducer = (state = initialState, action) => {
  switch(action.type) {
    case END_TOUR: {
      return Object.assign({}, state, {[action.name]: Object.assign({}, state[action.name], {run: false})});
    }
    case END_ALL_TOURS: {
      return Object.assign({}, state, {all: Object.assign({}, state.all, {run: false})});
    }
    case STOP_TOUR_AUTOSTART: {
      return Object.assign({}, state, {[action.name]: Object.assign({}, state[action.name], {autoStart: false})});
    }
    case STOP_ALL_TOUR_AUTOSTARTS: {
      return Object.assign({}, state, {all: Object.assign({}, state.all, {autoStart: false})});
    }
    default: {
      return state;
    }
  }
}

export default reducer;
