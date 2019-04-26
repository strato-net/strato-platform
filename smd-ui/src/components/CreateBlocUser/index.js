import React, { Component } from 'react';
import { openOverlay, closeOverlay, createBlocUser } from './createBlocUser.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import './createBlocUser.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';

class CreateBlocUser extends Component {

  componentDidMount() {
    mixpanelWrapper.track("create_user_loaded");
  }

  submit = (values) => {
    mixpanelWrapper.track('create_user_submit_click');
    this.props.createBlocUser(values.username, values.password);
  }

  render() {
    return (
    <div className="smd-pad-16">
      <Button onClick={() => {
        mixpanelWrapper.track('create_user_open_click');
        this.props.reset();
        this.props.openOverlay();
      }} className="pt-intent-primary pt-icon-add"
              id="accounts-create-user-button"
              text="Create User"/>


      <Dialog
          iconName="inbox"
          isOpen={this.props.isOpen}
          onClose={this.props.closeOverlay}
          title="Create New User"
          className="pt-dark"
      >
        <form>
          <div className="pt-dialog-body bloc-user-form">
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
              <Button text="Cancel" onClick={() => {
                mixpanelWrapper.track('create_user_close_click');
                this.props.reset();
                this.props.closeOverlay();
              }}/>
              <Button
                  intent={Intent.PRIMARY}
                  onClick={this.props.handleSubmit(this.submit)}
                  text="Create User"
              />
            </div>
          </div>
        </form>
      </Dialog>

    </div>
    );
  }
}

export function mapStateToProps(state) {
  let errors = { errors: undefined };
  if (state.form && state.form["create-bloc-user"]) {
    errors = { errors: state.form["create-bloc-user"].syncErrors }
  }
  return {
    isOpen: state.createBlocUser.isOpen,
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

const formed = reduxForm({ form: 'create-bloc-user', validate })(CreateBlocUser);
const connected = connect(
  mapStateToProps,
  {
    openOverlay,
    closeOverlay,
    createBlocUser,
  }
)(formed);

export default withRouter(connected);
