import React from 'react';
import './Tour.css';
import Joyride from 'react-joyride';
import { connect } from 'react-redux';
import { stopAllToursFromAutostarting } from './tour.actions';

const Tour = ({name, callback, run, steps, ref, autoStart, stopAllToursFromAutostarting}) => {
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
        callback(event);
        if((event.type === 'finished') || event.isSkipped || event.action === 'close') {
          stopAllToursFromAutostarting();
        }
      }}
      showOverlay={false}
      showSkipButton={true}
    />
  )
}


export default connect((state, ownProps) => {
  return {
    run: state.tour[ownProps.name].run && state.tour.all.run,
    autoStart: state.tour[ownProps.name].autoStart && state.tour.all.autoStart,
  }
}, { stopAllToursFromAutostarting })(Tour);
