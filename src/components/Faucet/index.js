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
    this.props.faucetRequest(values.username, values.password);
  }

  render() {
    const { submitting, error } = this.props
    return (
      <div>
        <Button onClick={() => {
          mixpanelWrapper.track('faucet_open_click');
          this.props.openFaucetOverlay()
        }} text="Faucet" className="pt-icon-add right-align" />
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={this.props.closeFaucetOverlay}
            title="Faucet"
            className="pt-dark"
          >
            <div className="pt-dialog-body">
              <div className="pt-form-group">
                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-a">
                    Username
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="username"
                      component="input"
                      type="text"
                      placeholder="Username"
                      className="pt-input form-width"
                      tabIndex="1"
                      required
                    />
                    <div className="pt-form-helper-text">{error && this.props.errors.username}</div>
                  </div>
                </div>

                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    Password
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="password"
                      component="input"
                      type="password"
                      placeholder="Password"
                      className="pt-input form-width"
                      tabIndex="2"
                      required
                    />
                    <div className="pt-form-helper-text">{error && this.props.errors.password}</div>
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
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track('faucet_close_click');
                  this.props.closeFaucetOverlay()
                }} />
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.props.handleSubmit(this.submit)}
                  text="Faucet"
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
    isOpen: state.faucet.isOpen,
    ...errors
  };
}

export function validate(values) {
  const errors = {};
  if (values.username === undefined && !values.username) {
    errors.username = "Username Required";
  }
  if (values.password === undefined && !values.password) {
    errors.password = "Password Required";
  }
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
