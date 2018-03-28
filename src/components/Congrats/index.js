import React from 'react';
import { AnchorButton, Button, Intent } from '@blueprintjs/core';
import './congrats.css'

const Congrats = (props) => {
  return (<div>
    <div className="pt-dialog-body congrats-container">
      <h2>Congratulations!</h2>
      <p>You’re approved for 1000 STR.</p>
    </div>
    <div className="pt-dialog-footer">
      <div className="pt-dialog-footer-actions">
        <Button text="Back"
          onClick={props.handleBack}
        />
        <Button text="Continue"
          onClick={props.handleContinue}
        />
      </div>
    </div>
  </div>);
}

export default Congrats;
