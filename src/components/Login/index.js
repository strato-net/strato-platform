import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter, Redirect } from 'react-router-dom';
import { Button, Card } from 'react-md';
import { validateUser } from './login.action';
import ReduxedTextField from '../ReduxedTextField';
import './login.css';
import { env } from '../../env'

class Login extends Component {

  submit = (values) => {
    this.props.validateUser({ username: values.username, password: values.password });
    this.setState({ redirectToReferrer: true });
  }

  render() {
    const { from } = this.props.location.state || { from: { pathname: '/' } }
    const {
      handleSubmit
    } = this.props;
    const { redirectToReferrer } = this.props.login

    if (redirectToReferrer) {
      if (this.props.app) {
        window.open(env.LOCAL_URL + this.props.app['url'], "_blank")
      }
      return (<Redirect to={from} />)
    }


    return (
      <section>
        <div className="md-grid">
          <Card className="md-block-centered content">
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
            <div className="md-cell md-cell--12 md-text-center">
              To use DApps on STRATO Public you need to create an account, please sign up here:
                </div>
            <div className="md-cell md-cell--12 md-text-center">
              <Button raised primary className="createAccountButton"
                onClick={() => this.props.history.push('/register')}> Create an account</Button>
            </div>
          </Card>
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
    validateUser
  }
)(formed);

export default withRouter(connected);