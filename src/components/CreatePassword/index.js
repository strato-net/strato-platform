import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button } from '@blueprintjs/core';
import { validate } from './validate';
import { createUser, resetError } from '../CreateUser/createUser.actions';
import { toasts } from "../Toasts";

class CreatePassword extends Component {

  constructor() {
    super();
    this.state = { errors: null }
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.serverError) {
      toasts.show({ message: nextProps.serverError });
      this.props.resetError();
    }
  }

  submit = (values) => {
    const errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      this.props.createUser(this.props.email, values.password);
    }
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  render() {
    const { handleSubmit } = this.props;

    return (
      <div className="smd-pad-16">
        <form>
          <div className="pt-dialog-body">
            <div className="pt-form-group">
              <div className="pt-form-group pt-intent-danger">
                <label className="pt-label" htmlFor="input-a">
                  Password
                  </label>
                <div className="pt-form-content">
                  <Field
                    name="password"
                    className="pt-input form-width smd-full-width"
                    placeholder="Password"
                    component="input"
                    type="password"
                    required
                  /> <br />
                  <span className="error-text">{this.errorMessageFor('password')}</span>
                </div>
              </div>

              <div className="pt-form-group pt-intent-danger">
                <label className="pt-label" htmlFor="input-b">
                  Confirm Password
                  </label>
                <div className="pt-form-content">
                  <Field
                    name="confirmPassword"
                    className="pt-input form-width"
                    placeholder="Confirm Password"
                    component="input"
                    type="password"
                    required
                  /> <br />
                  <span className="error-text">{this.errorMessageFor('confirmPassword')}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="pt-dialog-footer text-center">
            <div className="pt-dialog-footer-actions button-center">
              <Button onClick={handleSubmit(this.submit)} text="Submit" type="submit" />
            </div>
          </div>
        </form>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    serverError: state.createUser.error,
    email: state.user.firstTimeUser
  };
}

const formed = reduxForm({ form: 'createPassword' })(CreatePassword);
const connected = connect(
  mapStateToProps,
  {
    createUser,
    resetError
  }
)(formed);

export default withRouter(connected);
