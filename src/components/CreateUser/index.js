import React, { Component } from 'react';
import { openOverlay, closeOverlay, createUser } from './createUser.actions';
import { openLoginOverlay } from '../User/user.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import './CreateUser.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { openWalkThroughOverlay } from '../WalkThrough/walkThrough.actions';
import WalkThrough from '../WalkThrough';
import { toasts } from "../Toasts";

class CreateUser extends Component {

  componentDidMount() {
    mixpanelWrapper.track("create_user_loaded");
  }

  submit = (values) => {
    mixpanelWrapper.track('create_user_submit_click');
    this.props.createUser(values.username, values.password);
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.serverError)
      toasts.show({ message: nextProps.serverError });
  }

  render() {
    return (
      <div>
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={this.props.closeOverlay}
            title="Create New User"
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
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.username}</div>
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
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.password}</div>
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
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.confirm_password}</div>
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
                    this.props.closeOverlay();
                    this.props.openLoginOverlay();
                  }}
                />
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.props.handleSubmit(this.submit)}
                  text="Create User"
                />
              </div>
            </div>
          </Dialog>
        </form>
        <WalkThrough />
      </div>
    );
  }
}

export function mapStateToProps(state) {
  let errors = { errors: undefined };
  if (state.form && state.form["create-user"]) {
    errors = { errors: state.form["create-user"].syncErrors }
  }
  return {
    isOpen: state.createUser.isOpen,
    isLoggedIn: state.user.isLoggedIn,
    serverError: state.createUser.error,
    ...errors
  };
}

export function validate(values) {
  const errors = {};
  if (!values.username) {
    errors.username = "Username Required";
  }
  if (!values.password) {
    errors.password = "Password Required";
  }
  if (!values.confirm_password) {
    errors.confirm_password = "Must Confirm Password";
  }
  if (values.password !== values.confirm_password) {
    errors.confirm_password = "Passwords Do Not Match";
  }
  return errors;
}

const formed = reduxForm({ form: 'create-user', validate })(CreateUser);
const connected = connect(
  mapStateToProps,
  {
    openOverlay,
    closeOverlay,
    createUser,
    openWalkThroughOverlay,
    openLoginOverlay
  }
)(formed);

export default withRouter(connected);
