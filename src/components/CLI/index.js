import React, { Component } from 'react';
import { Button, Intent } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import mixpanelWrapper from '../../lib/mixpanelWrapper';

class CLI extends Component {

  render() {
    return (
      <div>
        <div className="pt-dialog-body">
          <div className="pt-form-group">
            <div className="pt-form-group pt-intent-danger">
              <div className="pt-form-content">
                <a href="https://www.npmjs.com/package/strato-cli">Click here</a> to learn how you can easily deploy dapps to STRATO
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
              text="Finish"
            />
          </div>
        </div>}
      </div>
    );
  }
}

export default withRouter(connect()(CLI));
