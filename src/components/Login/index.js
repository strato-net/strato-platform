import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { verifyAccount } from '../Account/account.actions';
import { Button } from '@blueprintjs/core';

class Login extends Component {
  
  submit = (values) => {
    const payload = {
      email: values.email,
      password: values.password
    };

    this.props.verifyAccount(payload);
    this.props.history.push('/home');
  }

  render() {
    const {handleSubmit} = this.props;

    return (
      <div className="container-fluid pt-dark" id="tour-welcome">
        <div className="row">
          <div className="col-sm-9 text-left">
            <h3>Login</h3>
          </div>
        </div>
        <form>
          <div className="pt-dialog-body">
            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label" style={{marginTop: '9px'}}>
                  Email
                </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
                <Field
                  name="email"
                  className="pt-input"
                  placeholder="Email"
                  component="input"
                  type="email"
                  required
                />
              </div>
            </div>
            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label" style={{marginTop: '9px'}}>
                  Password
                </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
                <Field
                  name="password"
                  className="pt-input"
                  placeholder="Password"
                  component="input"
                  type="password"
                  required
                />
              </div>
            </div>
            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button
                  className="pt-button pt-intent-primary"
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
    loginError: state.account.error, 
  };
}

const formed = reduxForm({ form: 'login' })(Login);
const connected = connect(
  mapStateToProps,
  {
    verifyAccount
  }
)(formed);

export default withRouter(connected);