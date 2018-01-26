import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter, Redirect } from 'react-router-dom';
import { Button, Card, Snackbar } from 'react-md';
import ReduxedTextField from '../../components/ReduxedTextField';
import { createUser, resetRedirectRefer, resetUserError } from './register.actions';
import './Register.css';
import { env } from '../../env'

class Register extends Component {

  componentWillUnmount() {
    this.props.resetRedirectRefer()
  }

  submit = (values) => {
    this.props.createUser(values.username, values.password);
  }

  render() {
    const { from } = this.props.location.state || { from: { pathname: '/' } }
    const { redirectToReferrer } = this.props.register
    if (redirectToReferrer) {
      if (this.props.app) {
        window.open(env.LOCAL_URL + this.props.app['url'], "_blank")
      }
      return (<Redirect to={from} />)
    }

    return (
      <section>
        <div className="md-grid">
          <Card className="md-block-centered content login-box">
            <div className="md-cell md-cell--12 md-text-center" style={{color: '#e7e7e7'}}>
              <i class="fa fa-user-circle fa-5x"></i>
            </div>
            <form>
              <div className="md-grid">
                <Field
                  name="username"
                  component={ReduxedTextField}
                  type="text"
                  placeholder="Username"
                  id="username"
                  className="md-cell md-cell--12 md-cell--center"
                  tabIndex="1"
                  required
                />
                <Field
                  name="password"
                  component={ReduxedTextField}
                  type="password"
                  placeholder="Password"
                  id="password"
                  className="md-cell md-cell--12"
                  tabIndex="2"
                  required
                />
                <Field
                  name="confirm_password"
                  component={ReduxedTextField}
                  type="password"
                  placeholder="Confirm Password"
                  id="confirm_password"
                  className="md-cell md-cell--12"
                  tabIndex="3"
                  required
                />
                <div className="md-cell md-cell--12" />
                <div className="md-cell md-cell--12 md-text-center">
                  <Button raised secondary className="loginButton" type="submit" onClick={this.props.handleSubmit(this.submit)}>
                    create account
                  </Button>
                </div>
              </div>
            </form>
          </Card>
          <Snackbar
            toasts={this.props.register.error ? [{ text: this.props.register.error }] : []}
            autohide={true}
            onDismiss={() => { this.props.resetUserError() }}
          />
        </div>
      </section>
    );
  }
}

export function validate(values) {
  const errors = {};
  let reg = /^.{9,19}$/;

  if (!values.username) {
    errors.username = "Username Required";
  }
  if (!reg.test(values.username)) {
    errors.username = "Username must be at least 10 characters and less than 20 characters";
  }
  if (!values.password) {
    errors.password = "Password Required";
  }
  if (!reg.test(values.password)) {
    errors.password = "Password must be at least 10 characters and less than 20 characters";
  }
  if (!values.confirm_password) {
    errors.confirm_password = "Must Confirm Password";
  }
  if (values.password !== values.confirm_password) {
    errors.confirm_password = "Passwords Do Not Match";
  }

  return errors;
}

export function mapStateToProps(state) {
  return {
    register: state.register,
    app: state.apps.selectedApp,
  };
}
const formed = reduxForm({ form: 'create-user', validate })(Register);
const connected = connect(
  mapStateToProps,
  {
    createUser,
    resetUserError,
    resetRedirectRefer
  }
)(formed);

export default withRouter(connected);
