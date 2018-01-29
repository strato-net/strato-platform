import './login.css'
import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter, Redirect } from 'react-router-dom';
import { Button, Card, Snackbar } from 'react-md';
import { validateUser, resetLoginMessage, resetRedirectRefer } from './login.action';
import ReduxedTextField from '../ReduxedTextField';


class Login extends Component {

  componentWillUnmount() {
    this.props.resetRedirectRefer()
  }

  submit = (values) => {
    this.props.validateUser({ username: values.username, password: values.password });
  }

  render() {
    const { from } = this.props.location.state || { from: { pathname: '/' } }
    const {
      handleSubmit
    } = this.props;
    const { redirectToReferrer } = this.props.login

    if (redirectToReferrer) {
      if (this.props.app) {
        window.open(`${window.location.host}${this.props.app['url']}`, "_blank")
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
            <form
              onSubmit={handleSubmit(this.submit)}
            >
              <div className="md-grid">
                <Field
                  id="username"
                  name="username"
                  type="text"
                  placeholder="Username"
                  required
                  className="md-cell md-cell--12 md-cell--center"
                  component={ReduxedTextField} />
                <Field
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Password"
                  required
                  className="md-cell md-cell--12"
                  component={ReduxedTextField} />
                <div className="md-cell md-cell--12" />
                <div className="md-cell md-cell--12 md-text-center">
                  <Button raised secondary className="loginButton" type="submit"> Login </Button>
                </div>
              </div>
            </form>
            <div className="md-cell md-cell--12 md-text-center msg-login">
              To use DApps on STRATO Public you need to create an account, please sign up here:
                </div>
            <div className="md-cell md-cell--12 md-text-center">
              <Button raised primary className="createAccountButton"
                onClick={() => this.props.history.push('/register')}> Create an account</Button>
            </div>
          </Card>
          <Snackbar
            toasts={this.props.login.result ? [{ text: this.props.login.result }] : []}
            autohide={true}
            onDismiss={() => { this.props.resetLoginMessage() }}
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

  return errors;
}

export function mapStateToProps(state) {
  return {
    login: state.login,
    app: state.apps.selectedApp,

  };
}
const formed = reduxForm({ form: 'login', validate })(Login);
const connected = connect(
  mapStateToProps,
  {
    validateUser,
    resetLoginMessage,
    resetRedirectRefer
  }
)(formed);

export default withRouter(connected);