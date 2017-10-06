import React from 'react';
import './Tour.css';
import Joyride from 'react-joyride';
import { connect } from 'react-redux';

const Tour = ({name, callback, run, steps, ref}) => {
  return (
    <Joyride
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


export default connect((state, ownProps) => {
  return {
    run: state.tour[ownProps.name].run,
  }
})(Tour);
