import React, { Component } from 'react';
import { createUser } from './createUser.actions';
import { openLoginOverlay } from '../User/user.actions';
import { Button, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import './CreateUser.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { openWalkThroughOverlay, closeWalkThroughOverlay } from '../WalkThrough/walkThrough.actions';
import { toasts } from "../Toasts";

class CreateUser extends Component {

  constructor() {
    super();
    this.state = { serverError: null, errors: null }
  }

  componentDidMount() {
    mixpanelWrapper.track("create_user_loaded");
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.serverError && this.state.serverError !== nextProps.serverError) {
      toasts.show({ message: nextProps.serverError });
      this.setState({ serverError: nextProps.serverError })
    }
  }

  submit = (values) => {
    const errors = validate(values);
    this.setState({ errors, serverError: null });
    if (JSON.stringify(errors) === JSON.stringify({})) {
      mixpanelWrapper.track('create_user_submit_click');
      this.props.createUser(values.username, values.password);
    }
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  render() {
    return (
      <form className="create-user">
        <div className="pt-dialog-body">
          <h4>STRATO is the best way to build blockchain applications</h4>
        </div>
        <div className="pt-dialog-body side-items">
          <ul className="feature-list">
            <li>Build dApps in hours, not days</li>
            <li>Search Queries for smart contracts</li>
            <li>Easily deploy apps to mobile or desktop seamlessly.</li>
          </ul>
        </div>
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
                <div className="pt-form-helper-text">{this.errorMessageFor('username')}</div>
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
                <div className="pt-form-helper-text">{this.errorMessageFor('password')}</div>
              </div>
            </div>

            <div className="pt-form-group pt-intent-danger">
              <label className="pt-label" htmlFor="input-b">
                Confirm Password
              </label>
              <div className="pt-form-content">
                <Field
                  name="confirm_password"
                  component="input"
                  type="password"
                  placeholder="Confirm Password"
                  className="pt-input form-width"
                  tabIndex="3"
                  required
                />
                <div className="pt-form-helper-text">{this.errorMessageFor('confirm_password')}</div>
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
              text="Already Have An Account?"
              onClick={() => {
                this.props.closeWalkThroughOverlay();
                this.props.openLoginOverlay();
              }}
            />
            <Button
              intent={Intent.PRIMARY}
              onClick={this.props.handleSubmit(this.submit)}
              text="Create User"
              disabled={this.props.spinning}
            />
          </div>
        </div>
      </form>
    );
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.createUser.isOpen,
    isLoggedIn: state.user.isLoggedIn,
    serverError: state.createUser.error,
    spinning: state.createUser.spinning
  };
}

export function validate(values) {
  const errors = {};
  if (!values.username) {
    errors.username = "Username Required";
  } else if (values.username.length < 2 || values.username.length > 15) {
    errors.username = "Username must be at least 2 characters and 15 characters max";
  }
  if (!values.password) {
    errors.password = "Password Required";
  } else if (values.password.length < 6) {
    errors.password = "Password must be at least 6 characters";
  }
  if (!values.confirm_password) {
    errors.confirm_password = "Must Confirm Password";
  }
  if (values.password !== values.confirm_password) {
    errors.confirm_password = "Passwords Do Not Match";
  }
  return errors;
}

const formed = reduxForm({ form: 'create-user' })(CreateUser);
const connected = connect(
  mapStateToProps,
  {
    createUser,
    openWalkThroughOverlay,
    closeWalkThroughOverlay,
    openLoginOverlay
  }
)(formed);

export default withRouter(connected);
