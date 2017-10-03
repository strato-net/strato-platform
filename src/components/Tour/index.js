import React from 'react';
import './Tour.css';
import Joyride from 'react-joyride';
import { connect } from 'react-redux';

const Tour = ({callback, run, steps, ref}) => {
  return (
    <Joyride
      ref = {ref}
      steps={steps}
      run={run}
      locale={{last: 'Continue', next: 'Continue', back: 'Back', skip: 'Skip', close: 'Close'}}
      type="continuous"
      debug={true}
      autoStart={true}
      callback={callback}
      disableOverlay={true}
      showSkipButton={true}
    />
  )
}


export default connect(state => {
  return {
    run: state.tour.run,
    // steps: state.tour.steps,
  }
})(Tour);
