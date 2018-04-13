import React, { Component } from 'react';
import { Button, Intent } from '@blueprintjs/core';
import { Field } from 'redux-form';
import RequestTokenImage from './faucet.png';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './faucet.css';

class Faucet extends Component {
  constructor(props) {
    super(props);
    this.state = {
      sendEmailBtnClicked: false
    }
  }

  submit = (values) => {
    mixpanelWrapper.track('faucet_submit_click');
    let mailto = `mailto:product@blockapps.net?subject=Faucet Request&body=${values.building}. My address is ${this.props.currentUser.accountAddress}.`;
    window.location.href = mailto;
    this.props.faucetRequest(this.props.accountAddress);
    this.setState({ sendEmailBtnClicked: true });
  }

  render() {
    return (
      <div>
        <div className="pt-dialog-body faucet-container">
          <div className="pt-form-group">
            <div className="faucet-title">
              <h4>Request STRATO tokens to use and launch apps.</h4>
            </div>

            <div className="faucet-body">
              <img src={RequestTokenImage} alt="Request Token" className="side-image" />

              <div className="pt-form-group pt-intent-danger faucet-form">
                <label className="pt-label" htmlFor="input-b">
                  Using and launching apps requires tokens. Tell us what you are building so we can fund you.
								</label>
                <div className="pt-form-content">
                  <Field
                    name="building"
                    component="textarea"
                    type="text"
                    placeholder="I am building..."
                    className="pt-input form-width"
                    tabIndex="3"
                    required
                  />
                  <div className="pt-form-helper-text">{this.props.errors && this.props.errors.building}</div>
                  {this.state.sendEmailBtnClicked
                    ? <p className="send-email-text">Send an email to product@blockapps.net with your address and use-case to receive your tokens.</p>
                    : null}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="col-sm-3"></div>
            <div className="col-sm-3"></div>
            <div className="col-sm-3"></div>
          </div>
        </div>

        <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions">
            <Button
              intent={Intent.PRIMARY}
              onClick={this.props.handleSubmit(this.submit)}
              text="Send email to BlockApps"
              disabled={this.props.submitting}
            />
          </div>
        </div>
      </div>
    )
  }
}

export default Faucet;