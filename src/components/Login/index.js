import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { login, openLoginOverlay, closeLoginOverlay, resetError } from '../User/user.actions';
import { Button, Dialog } from '@blueprintjs/core';
import validate from './validate.js';
import { openOverlay } from '../CreateUser/createUser.actions';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './Login.css';
import { launchApp, resetSelectedApp } from '../Applications/applications.actions';
import { toasts } from "../Toasts";

class Login extends Component {

  constructor() {
    super();
    this.state = { errors: null }
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      const payload = {
        username: values.username,
        password: values.password
      };

      this.props.login(payload);
    }
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  componentWillReceiveProps(newProps) {
    if (newProps.isLoggedIn && newProps.selectedApp) {
      newProps.launchApp(newProps.selectedApp.address, newProps.selectedApp.url)
      newProps.resetSelectedApp();
    }

    if (newProps.serverError) {
      toasts.show({ message: newProps.serverError });
      this.props.resetError();
    }
  }

  render() {
    const { handleSubmit } = this.props;

    return (
      <div className="smd-pad-16">
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={() => {
              this.props.resetSelectedApp()
              this.props.closeLoginOverlay()
            }}
            title="Login"
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
                      className="pt-input form-width smd-full-width"
                      placeholder="Username"
                      component="input"
                      type="input"
                      required
                    /> <br />
                    <span className="error-text">{this.errorMessageFor('username')}</span>
                  </div>
                </div>

                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    Password
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="password"
                      className="pt-input form-width"
                      placeholder="Password"
                      component="input"
                      type="password"
                      required
                    /> <br />
                    <span className="error-text">{this.errorMessageFor('password')}</span>
                  </div>
                </div>
              </div>
              <div>
                <div className="col-sm-3"></div>
                <div className="col-sm-3"></div>
                <div className="col-sm-3"></div>
              </div>
            </div>

            <div className="pt-dialog-footer text-center">
              <div className="pt-dialog-footer-actions">
                <Button onClick={() => {
                  mixpanelWrapper.track('create_user_open_click');
                  this.props.closeLoginOverlay();
                  this.props.openOverlay();
                }} text="Create User" className="pt-icon-add" />
                <Button
                  type="button"
                  onClick={handleSubmit(this.submit)}
                  text={'Login'}
                  disabled={this.props.spinning}
                  className="pt-intent-primary pt-icon-log-in"
                />
              </div>
            </div>
          </Dialog>
        </form>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    isLoggedIn: state.user.isLoggedIn,
    from: state.user.from,
    isOpen: state.user.isOpen,
    selectedApp: state.applications.selectedApp,
    serverError: state.user.error,
    spinning: state.user.spinning
  };
}

const formed = reduxForm({ form: 'login' })(Login);
const connected = connect(
  mapStateToProps,
  {
    login,
    openLoginOverlay,
    closeLoginOverlay,
    openOverlay,
    launchApp,
    resetSelectedApp,
    resetError
  }
)(formed);

export default withRouter(connected);
