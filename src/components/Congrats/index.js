import React from 'react';
import { Button } from '@blueprintjs/core';
import './congrats.css'

const Congrats = (props) => {
  return (<div>
    <div className="pt-dialog-body congrats-container">
      <h2>Congratulations!</h2>
      <p>You’re approved for 1000 STR.</p>
    </div>
    <div className="pt-dialog-footer">
      <div className="pt-dialog-footer-actions">
        <Button text="Continue"
          onClick={props.handleContinue}
        />
      </div>
    </div>
  </div>);
}

export default Congrats;
