import React from 'react';
import './Tour.css';
import Joyride from 'react-joyride';
import { connect } from 'react-redux';
import { stopAllToursFromAutostarting, endTour } from './tour.actions';
import { withRouter } from 'react-router';

const Tour = ({ name, callback, run, steps, ref, autoStart, endTour, stopAllToursFromAutostarting, finalStepSelector, nextPage = null, history }) => {
  return (
    <Joyride
      steps={steps}
      run={false} // if needed in future just pass *run* variable
      locale={{ last: 'Continue', next: 'Continue', back: 'Back', skip: 'Skip', close: 'Close' }}
      type='continuous' // As opposed to 'single'
      debug={false}
      autoStart={autoStart}
      showBackButton={false}
      callback={event => {
        if (event.action === 'close') {
          endTour(name);
          return;
        }
        if (event.isTourSkipped) {
          stopAllToursFromAutostarting();
          return;
        }

        if ((event.type === 'step:after' && event.step.selector === finalStepSelector)) {
          if (nextPage) {
            history.push(nextPage);
          } else {
            stopAllToursFromAutostarting();
          }
          endTour(name);
        }
      }}
      showOverlay={false}
      showSkipButton={true}
    />
  )
}

export function mapStateToProps(state, ownProps) {
  return {
    run: state.tour[ownProps.name].run && state.tour.all.run,
    autoStart: state.tour[ownProps.name].autoStart && state.tour.all.autoStart,
  }
}

export default withRouter(connect(mapStateToProps, { stopAllToursFromAutostarting, endTour })(Tour));
