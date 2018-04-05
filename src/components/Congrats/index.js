import React from 'react';
import { Button } from '@blueprintjs/core';
import './congrats.css'

const Congrats = (props) => {
  return (<div>
    <div className="pt-dialog-body congrats-container">
      <h2>Great work!</h2>
      <p>Your account has been funded with 1000 STRATO tokens.</p>
    </div>
    <div className="pt-dialog-footer">
      <div className="pt-dialog-footer-actions button-center">
        <Button text="Continue"
          onClick={props.handleContinue}
        />
      </div>
    </div>
  </div>);
}

export default Congrats;
