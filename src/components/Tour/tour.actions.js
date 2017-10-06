export const END_TOUR = 'END_TOUR';

export const endTour = (name) => {
  return { type: END_TOUR, name};
}
