export const TOGGLE_DASHBOARD_TOUR = 'TOGGLE_DASHBOARD_TOUR';
export const ADD_STEPS_TO_TOUR = 'ADD_STEPS_TO_TOUR';

export const toggleDashboardTour = () => {
  return { type: TOGGLE_DASHBOARD_TOUR };
}

export const addStepsToTour = (steps) => {
  return { type: ADD_STEPS_TO_TOUR, steps};
}
