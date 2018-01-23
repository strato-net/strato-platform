import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Card, CardTitle, CardText, TextField, Media } from 'react-md';
import './login.css';
import { validateUser } from './login.action';
import ReduxedTextField from '../ReduxedTextField'

class Login extends Component {

  submit = (values) => {
    this.props.validateUser({ username: values.username, password: values.password });
  }

  render() {
    const {
      handleSubmit
    } = this.props;

    return (
      <section>
        <div className="md-grid">
          <Card className="md-block-centered content">
            {/* <div className="md-cell md-cell--12 md-text-center">
              <img src="img/user.png" alt="Login splash" />
            </div> */}
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
                  <Button raised secondary className="loginButton" label="Login" type="submit"
                  />
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
  console.log(values)
  const errors = {};
  if (!values.username) {
    errors.username = "Username Required";
  }
  if (!values.password) {
    errors.password = "Password Required";
  }
  return errors;
}

export function mapStateToProps(state) {
  return {
    state
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