import React from 'react';
import './Tour.css';
import Joyride from 'react-joyride';
import { connect } from 'react-redux';
import { stopAllToursFromAutostarting, endTour } from './tour.actions';
import { withRouter } from 'react-router';

const Tour = ({ name, callback, run, steps, ref, autoStart, endTour, stopAllToursFromAutostarting, finalStepSelector, nextPage = null, history }) => {
  console.log("---------------------run ", run)
  return (
    <Joyride
      steps={steps}
      run={run}
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
    // INFO: https://blockapps.atlassian.net/browse/STRATO-1395 (it is remove or disabled)
    // It is better to disabled this. If needed in future just uncomment below line and remove run: false,
    // run: state.tour[ownProps.name].run && state.tour.all.run,
    run: false,
    autoStart: state.tour[ownProps.name].autoStart && state.tour.all.autoStart,
  }
}

export default withRouter(connect(mapStateToProps, { stopAllToursFromAutostarting, endTour })(Tour));
