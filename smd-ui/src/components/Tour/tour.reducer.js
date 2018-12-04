import { END_TOUR, END_ALL_TOURS, STOP_TOUR_AUTOSTART, STOP_ALL_TOUR_AUTOSTARTS } from './tour.actions';

const skipTour = localStorage.getItem('skip_tour') === 'true';

const initialState = {
  dashboard: {run: !skipTour, autoStart: !skipTour},
  chains: {run: !skipTour, autoStart: !skipTour},
  transactions: {run: !skipTour, autoStart: !skipTour},
  accounts: {run: !skipTour, autoStart: !skipTour},
  contracts: {run: !skipTour, autoStart: !skipTour},
  all: {run: !skipTour, autoStart: !skipTour},
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
      localStorage.setItem('skip_tour','true');
      return Object.assign({}, state, {all: Object.assign({}, state.all, {run: false , autoStart: false})});
    }
    default: {
      return state;
    }
  }
}

export default reducer;
