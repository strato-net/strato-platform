export const callAfterTour = (finalSelector, callback) => {
  return (event) => {
    if((event.type === 'step:after' && event.step.selector === finalSelector)) {
      callback();
    }
  }
}
