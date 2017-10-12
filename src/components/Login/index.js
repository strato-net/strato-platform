import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { verifyUser } from '../User/user.actions';
import { Button } from '@blueprintjs/core';
import validate from './validate.js';

class Login extends Component {
  
  constructor() {
    super();
    this.state = {errors: null}
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({errors});

    if (JSON.stringify(errors) === JSON.stringify({})) {
      const payload = {
        email: values.email,
        password: values.password
      };
  
      this.props.verifyUser(payload);
      this.props.history.push('/home');
    } 
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  render() {
    const {handleSubmit} = this.props;

    return (
      <div className="container-fluid pt-dark" id="tour-welcome" style={{marginTop: '56px'}}>
        <form style={{margin: '0px auto', display: 'table'}} className="pt-card pt-dark pt-elevation-2">
          <div className="pt-dialog-body">
            <div className="row">
              <div className="col-sm-12 text-center">
                <h3>Login</h3>
              </div>
            </div>
            <div className="row">
              <div className="col-sm-4 text-right">
                <label className="pt-label" style={{marginTop: '9px'}}>
                  Email
                </label>
              </div>
              <div className="col-sm-8 smd-pad-4">
                <Field
                  name="email"
                  className="pt-input"
                  placeholder="Email"
                  component="input"
                  type="email"
                  required
                /> <br/>
                <span style={{color: 'red', fontSize: '10px'}}>{this.errorMessageFor('email')}</span>
              </div>
            </div>
            <div className="row">
              <div className="col-sm-4 text-right">
                <label className="pt-label" style={{marginTop: '9px'}}>
                  Password
                </label>
              </div>
              <div className="col-sm-8 smd-pad-4">
                <Field
                  name="password"
                  className="pt-input"
                  placeholder="Password"
                  component="input"
                  type="password"
                  required
                /> <br/>
                <span style={{color: 'red', fontSize: '10px'}}>{this.errorMessageFor('password')}</span>
              </div>
            </div>
            <div className="row">
              <div className="col-sm-12 text-center">
                <Button
                  className="pt-button pt-intent-primary col-pad-4"
                  style={{marginTop: '10px', width: '10pc'}}
                  type="button"
                  onClick={handleSubmit(this.submit)}
                  text={'Login'}
                />
              </div>
            </div>
            <div> { this.props.loginError || '' } </div>
          </div>
        </form>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    loginError: state.user.error, 
  };
}

const formed = reduxForm({ form: 'login' })(Login);
const connected = connect(
  mapStateToProps,
  {
    verifyUser
  }
)(formed);

export default withRouter(connected);
