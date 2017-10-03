export const START_TOUR = 'TOGGLE_TOUR';
export const ADD_STEPS_TO_TOUR = 'ADD_STEPS_TO_TOUR';

export const startTour = () => {
  return { type: START_TOUR };
}

export const addStepsToTour = (steps) => {
  return { type: ADD_STEPS_TO_TOUR, steps};
}
