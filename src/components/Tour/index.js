import React from 'react';
import './Tour.css';
import Joyride from 'react-joyride';
import { connect } from 'react-redux';
import { stopAllToursFromAutostarting, endTour } from './tour.actions';
import { callAfterTour } from './tour.helpers';
import { withRouter } from 'react-router';

const Tour = ({name, callback, run, steps, ref, autoStart, endTour, stopAllToursFromAutostarting, finalStepSelector, nextPage = null, history}) => {
  return (
    <Joyride
      steps={steps}
      run={run}
      locale={{last: 'Continue', next: 'Continue', back: 'Back', skip: 'Skip', close: 'Close'}}
      type='continuous' // As opposed to 'single'
      // debug={true}
      autoStart={autoStart}
      showBackButton={false}
      callback={event => {
        callAfterTour(finalStepSelector, () => {
          if(nextPage) history.push(nextPage);
          endTour(name);
        })(event);

        if(event.isTourSkipped || event.action === 'close') {
          endTour(name);
          stopAllToursFromAutostarting();
        }
      }}
      showOverlay={false}
      showSkipButton={true}
    />
  )
}


export default withRouter(connect((state, ownProps) => {
  return {
    run: state.tour[ownProps.name].run && state.tour.all.run,
    autoStart: state.tour[ownProps.name].autoStart && state.tour.all.autoStart,
  }
}, { stopAllToursFromAutostarting, endTour })(Tour));
