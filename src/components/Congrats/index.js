import React from 'react';
import { AnchorButton, Button, Intent } from '@blueprintjs/core';
import './congrats.css'

const Congrats = (props) => {
  return (<div>
    <div className="pt-dialog-body congrats-container">
      <h2>Congratulations!</h2>
      <p>You’re ready to start building apps - visit our developers website for more information.</p>
    </div>
    <div className="pt-dialog-footer">
      <div className="pt-dialog-footer-actions">
        <Button text="Back"
          onClick={props.handleBack}
        />
        <AnchorButton
          intent={Intent.PRIMARY}
          href="https://developers.blockapps.net/advanced/launch-dapp/"
          target="_blank"
          onClick={props.closeWalkThroughOverlay}
          text="Get Started"
        />
      </div>
    </div>
  </div>);
}

export default Congrats;
