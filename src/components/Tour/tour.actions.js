export const END_TOUR = 'END_TOUR';
export const END_ALL_TOURS = 'END_ALL_TOURS';
export const STOP_TOUR_AUTOSTART = 'STOP_TOUR_AUTOSTART';
export const STOP_ALL_TOUR_AUTOSTARTS = 'STOP_ALL_TOUR_AUTOSTARTS';

export const endTour = (name) => {
  return { type: END_TOUR, name };
}

export const endAllTours = () => {
  return { type: END_ALL_TOURS };
}

export const stopAllToursFromAutostarting = () => {
  return { type: STOP_ALL_TOUR_AUTOSTARTS };
}

export const stopTourAutostart = (name) => {
  return { type: STOP_TOUR_AUTOSTART, name };
}
