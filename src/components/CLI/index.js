import React, { Component } from 'react';
import { AnchorButton, Button, Intent } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import './cli.css';

class CLI extends Component {

  render() {
    return (
      <div>
        <div className="pt-dialog-body">
          <div className="pt-form-group">
            <div className="pt-form-content cli-container">
              <h4>Download the STRATO CLI to deploy apps from the command line.</h4>
              <div className="cli-content">
                <p>Pre-requisites:<br></br>Node JS (Version 6 and up)</p>
                <ol>
                  <li>Once you have Node JS installed, run <code>npm install -g strato-cli</code></li>
                  <li>Test your installation by running the <code>strato --version</code></li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions">
            {this.props.addApp 
              ? <AnchorButton
                intent={Intent.PRIMARY}
                text="Read Docs"
                href="https://developers.blockapps.net/advanced/launch-dapp/"
                target="_blank"
                className="read-docs-btn"
              /> 
              : <div>
                  <Button text="Back" onClick={() => {
                    this.props.handleBack();
                  }} />
                  <Button text="Continue" intent={Intent.PRIMARY} onClick={() => {
                    this.props.handleContinue();
                  }} />
                </div>
            }
          </div>
        </div>
      </div>
    );
  }
}

export default withRouter(connect()(CLI));
