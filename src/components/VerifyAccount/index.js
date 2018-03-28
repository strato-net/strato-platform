import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Dialog } from '@blueprintjs/core';
import { validate } from './validate';
import { closeVerifyAccountModal, verifyOTP } from '../VerifyAccount/verifyAccount.actions';

class VerifyAccount extends Component {

  constructor() {
    super();
    this.state = { errors: null }
  }

  submit = (values) => {
    const errors = validate(values);
    this.setState({ errors });
    if (JSON.stringify(errors) === JSON.stringify({})) {
      this.props.verifyOTP(values);
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
          <Dialog
            iconName="key"
            isOpen={this.props.isOpen}
            title="OTP verification"
            className="pt-dark"
            canOutsideClickClose={false}
            canEscapeKeyClose={false}
            isCloseButtonShown={false}
          >
            <div className="pt-dialog-body">
              <div className="pt-form-group">
                <h5> Alert: a temporary password has been sent to your email address </h5>
                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-a">
                    Enter OTP
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="OTP"
                      className="pt-input form-width smd-full-width"
                      placeholder="OTP"
                      component="input"
                      type="password"
                      required
                    /> <br />
                    <span className="error-text">{this.errorMessageFor('password')}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="pt-dialog-footer text-center">
              <div className="pt-dialog-footer-actions">
                <Button onClick={handleSubmit(this.submit)} text="Submit" />
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
    isOpen: state.verifyAccount.isOpen,
    email: state.user.firstTimeUser
  };
}

const formed = reduxForm({ form: 'verifyAccount' })(VerifyAccount);
const connected = connect(
  mapStateToProps,
  {
    closeVerifyAccountModal,
    verifyOTP
  }
)(formed);

export default withRouter(connected);
