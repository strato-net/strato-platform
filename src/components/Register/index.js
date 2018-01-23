import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import { Button, Card, CardTitle, CardText, TextField, Media } from 'react-md';
import './Register.css';

class Register extends Component {

  render() {
    return (
      <section>
        <div className="md-grid">
        <Card className="md-block-centered content">
          {/* <div className="md-cell md-cell--12 md-text-center">
              <img src="img/user.png" alt="Login splash" />
             </div> */}
              <form  
              onChange={(e)=>{}} //Detects the change in form fields
              >
                <div className="md-grid">
                  <Field
                    id="username"
                    name="username"
                    type="text"
                    placeholder="Username"
                    required
                    className="md-cell md-cell--12 md-cell--center"
                    component={TextField} />
                  <Field
                    id="password"
                    name="password"
                    type="text"
                    placeholder="Password"
                    required
                    className="md-cell md-cell--12"
                    component={TextField} />
                   <Field
                    id="confirmpassword"
                    name="confirmpassword"
                    placeholder="Confirm password"
                    type="text"
                    required
                    className="md-cell md-cell--12"
                    component={TextField} />            
                  <div className="md-cell md-cell--12" />
                  <div className="md-cell md-cell--12 md-text-center">
                    <Button raised secondary className="loginButton" label="create account" type="submit" 
                    />
                  </div>
                </div>
              </form>
          
                    </Card>
        </div>
      </section>
    );
  }
}

export function validate (values) {
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
   state
  };
}
const formed = reduxForm({ form: 'login-user', validate })(Register);
const connected = connect(
  mapStateToProps,
  {
    
  }
)(formed);

export default withRouter(connected);
