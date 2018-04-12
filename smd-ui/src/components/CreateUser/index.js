import React, { Component } from 'react';
import { openLoginOverlay, firstTimeLogin, resetError } from '../User/user.actions';
import { Button, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import './CreateUser.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { closeWalkThroughOverlay } from '../WalkThrough/walkThrough.actions';
import { toasts } from "../Toasts";

class CreateUser extends Component {

  constructor() {
    super();
    this.state = { errors: null }
  }

  componentDidMount() {
    mixpanelWrapper.track("create_user_loaded");
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.serverError) {
      toasts.show({ message: nextProps.serverError });
      this.setState({ serverError: nextProps.serverError })
      this.props.resetError();
    }
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      this.props.firstTimeLogin(values.email);
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
        <h4>STRATO is the best way to build blockchain applications</h4>
        <div className="pt-dialog-body">
          <ul className="feature-list">
            <li>Deploy dApps in 5 minutes</li>
            <li>Query the blockchain directly </li>
            <li>Host your app on desktop or mobile</li>
          </ul>
        </div>
        <div className="pt-dialog-body">
          <div className="pt-form-group create-user-form">
            <div className="pt-form-group pt-intent-danger email-section">
              <label className="pt-label" htmlFor="input-a">
                Email Address
              </label>
              <div className="pt-form-content">
                <Field
                  name="email"
                  className="pt-input form-width smd-full-width"
                  placeholder="Email Address"
                  component="input"
                  type="email"
                  required
                /> <br />
                <span className="error-text">{this.errorMessageFor('email')}</span>
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
          <div className="pt-dialog-footer-actions button-center">
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
              text="Submit"
              type="submit"
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
    spinning: state.user.spinning
  };
}

export function validate(values) {
  const errors = {};
  if (!values.email) {
    errors.email = 'Please enter a email address';
  } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i.test(values.email)) {
    errors.email = 'Please enter a valid email address';
  }

  return errors;
}

const formed = reduxForm({ form: 'create-user' })(CreateUser);
const connected = connect(
  mapStateToProps,
  {
    closeWalkThroughOverlay,
    openLoginOverlay,
    firstTimeLogin,
    resetError,
  }
)(formed);

export default withRouter(connected);
