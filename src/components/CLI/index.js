import React, { Component } from 'react';
import { Button, Intent } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './cli.css';

class CLI extends Component {

  render() {
    return (
      <div>
        <div className="pt-dialog-body">
          <div className="pt-form-group">
            <div className="pt-form-group pt-intent-danger">
              <div className="pt-form-content">
                <h4>Download the STRATO CLI to begin developing applications on the STRATO Blockchain.</h4>
                <div className="cli-content">
                  <p>Pre-requisites:</p>
                  <p>Node JS (Version 6 and up)</p>
                  <p>Your favorite code editor for solidity (our team uses Sublime or Atom)</p>
                  <ol>
                    <li>Once you have Node JS installed, run npm install -g strato-cli
                        Your system will automatically install the STRATO CLI Tool from the NPM repository.
                    </li>
                    <li>Test your installation by running the command strato --version</li>
                  </ol>
                  <p>Congratulations! You're all set to start building apps using BlockApps STRATO.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {this.props.addApp ? null : <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions">
            <Button text="Back" onClick={() => {
              mixpanelWrapper.track('faucet_close_click');
              this.props.handleBack();
            }} />
            <Button
              intent={Intent.PRIMARY}
              onClick={() => {
                this.setState({ initialModal: "Faucet" });
                this.props.handleFinish();
              }}
              text="Get Started"
            />
          </div>
        </div>}
      </div>
    );
  }
}

export default withRouter(connect()(CLI));
