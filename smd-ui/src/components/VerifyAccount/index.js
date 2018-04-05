import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button } from '@blueprintjs/core';
import { validate } from './validate';
import { verifyTempPassword, resetError } from '../VerifyAccount/verifyAccount.actions';
import { toasts } from "../Toasts";
import './VerifyAccount.css';

class VerifyAccount extends Component {

  constructor() {
    super();
    this.state = { errors: null }
  }

  componentWillReceiveProps(newProps) {
    if (newProps.serverError) {
      toasts.show({ message: newProps.serverError });
      this.props.resetError();
    }
  }

  submit = (values) => {
    const errors = validate(values);
    this.setState({ errors });
    if (JSON.stringify(errors) === JSON.stringify({})) {
      this.props.verifyTempPassword(values, this.props.email);
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
      <div className="account-body">
        <form>
          <div className="account-content">
            <div className="pt-form-group">
              <center><h5 style={{color: '#00AE52'}}> A temporary password has been sent to your email address </h5></center>
              <div className="pt-form-group pt-intent-danger">
                <label className="pt-label" htmlFor="input-a">
                  Enter temporary password
                  </label>
                <div className="pt-form-content">
                  <Field
                    name="tempPassword"
                    className="pt-input form-width smd-full-width"
                    placeholder="Your temporary password"
                    component="input"
                    type="password"
                    required
                  /> <br />
                  <span className="error-text">{this.errorMessageFor('tempPassword')}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="pt-dialog-footer">
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
    isOpen: state.verifyAccount.isOpen,
    serverError: state.verifyAccount.error,
    email: state.user.firstTimeUser
  };
}

const formed = reduxForm({ form: 'verifyAccount' })(VerifyAccount);
const connected = connect(
  mapStateToProps,
  {
    verifyTempPassword,
    resetError
  }
)(formed);

export default withRouter(connected);
