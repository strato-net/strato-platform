import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Card } from 'react-md';
import ReduxedTextField from '../../components/ReduxedTextField';
import { createUser } from './register.actions';
import './Register.css';

class Register extends Component {

  submit = (values) => {
    this.props.createUser(values.username, values.password);
  }

  render() {
    return (
      <section>
        <div className="md-grid">
          <Card className="md-block-centered content">
            <div className="md-cell md-cell--12 md-text-center">
              <img src="img/user.png" alt="Login splash" />
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
        </div>
      </section>
    );
  }
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

export function mapStateToProps(state) {
  return {

  };
}
const formed = reduxForm({ form: 'create-user', validate })(Register);
const connected = connect(
  mapStateToProps,
  {
    createUser
  }
)(formed);

export default withRouter(connected);
