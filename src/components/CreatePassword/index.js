import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Dialog } from '@blueprintjs/core';
import { validate } from './validate';
import { closeCreatePasswordModal } from './createPassword.actions';

class CreatePassword extends Component {

  constructor() {
    super();
    this.state = { errors: null }
  }

  submit = (values) => {
    const errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      // TODO call action that create user in bloc 
      this.props.closeCreatePasswordModal();
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
            onClose={() => {
              this.props.reset();
              this.props.closeCreatePasswordModal();
            }}
            title="Create Password"
            className="pt-dark"
            canOutsideClickClose={false}
            canEscapeKeyClose={false}
            isCloseButtonShown={false}
          >
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
    isOpen: state.createPassword.isOpen,
  };
}

const formed = reduxForm({ form: 'createPassword' })(CreatePassword);
const connected = connect(
  mapStateToProps,
  {
    closeCreatePasswordModal
  }
)(formed);

export default withRouter(connected);
