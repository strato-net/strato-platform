import React, { Component } from 'react';
import { closeTokenRequestOverlay } from './tokenRequest.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import './tokenRequest.css';

import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { faucetRequest } from '../Accounts/accounts.actions';

class TokenRequest extends Component {

  submit = (values) => {
    mixpanelWrapper.track('Faucet_click');
    // TODO with user address(JWT)
    const mailto = `mailto:product@blockapps.net?subject=Faucet Request&body=${values.building}. My address is ${this.props.currentUser.accountAddress}.`;
    window.location.href = mailto;
    this.props.faucetRequest(this.props.currentUser.accountAddress);
  }

  render() {
    return (
      <Dialog
        isOpen={this.props.isTokenOpen}
        onClose={this.props.closeTokenRequestOverlay}
        title="STRATO Token Request Form"
        className="pt-dark"
      >
        <div>
          <div className="pt-dialog-body">
            <div className="pt-form-group">
              <div className="pt-form-group pt-intent-danger">
                <div className="pt-form-content">
                  Using and launching apps requires tokens. Please complete the form below to email us your token request.
                    </div>
              </div>

              <div className="pt-form-group pt-intent-danger">
                <label className="pt-label" htmlFor="input-b">
                  What are you building?
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
                text="Submit"
                disabled={this.props.submitting}
              />
            </div>
          </div>
        </div>
      </Dialog>
    );
  }
}

export function mapStateToProps(state) {
  let errors = { errors: undefined };

  if (state.form && state.form["tokenRequest"]) {
    errors = { errors: state.form["tokenRequest"].syncErrors }
  }
  return {
    isTokenOpen: state.tokenRequest.isTokenOpen,
    currentUser: state.user.currentUser,
    ...errors
  };
}

export function validate(values) {
  const errors = {};
  if (values.building === undefined && !values.building) {
    errors.building = "Please tell us what are you building";
  }

  return errors;
}

const formed = reduxForm({ form: 'tokenRequest', validate })(TokenRequest);
const connected = connect(mapStateToProps, {
  closeTokenRequestOverlay,
  faucetRequest
})(formed);

export default withRouter(connected);
