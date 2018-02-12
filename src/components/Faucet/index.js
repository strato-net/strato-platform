import React, { Component } from 'react';
import { openFaucetOverlay, closeFaucetOverlay, faucetRequest } from './faucet.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import './faucet.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';

class Faucet extends Component {

  componentDidMount() {
    mixpanelWrapper.track("faucet_loaded");
  }

  submit = (values) => {
    mixpanelWrapper.track('faucet_submit_click');
    let mailto = `mailto:product@blockapps.net?subject=Faucet Request&body=${values.building}. My address is <USER ADDRESS>.`;
    window.location.href = mailto;
    this.props.closeFaucetOverlay();
  }

  render() {
    const { submitting, error } = this.props
    return (
      <div>
        {/* <Button onClick={() => {
          mixpanelWrapper.track('faucet_open_click');
          this.props.openFaucetOverlay()
        }} text="Faucet" className="pt-icon-add right-align" /> */}
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isTokenOpen}
            onClose={this.props.closeFaucetOverlay}
            title="STRATO Token Request Form"
            className="pt-dark"
          >
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
                      placeholder="What are you building?"
                      className="pt-input form-width"
                      tabIndex="3"
                      required
                    />
                    <div className="pt-form-helper-text">{error && this.props.errors.building}</div>
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
                <Button text="Continue" onClick={() => {
                  mixpanelWrapper.track('faucet_close_click');
                  this.props.closeFaucetOverlay()
                }} />
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.props.handleSubmit(this.submit)}
                  text="Submit"
                  disabled={submitting}
                />
              </div>
            </div>
          </Dialog>
        </form>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  let errors = { errors: undefined };
  if (state.form && state.form["faucet"]) {
    errors = { errors: state.form["faucet"].syncErrors }
  }
  return {
    isTokenOpen: state.faucet.isTokenOpen,
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

const formed = reduxForm({ form: 'faucet', validate })(Faucet);
const connected = connect(
  mapStateToProps,
  {
    openFaucetOverlay,
    closeFaucetOverlay,
    faucetRequest,
  }
)(formed);

export default withRouter(connected);