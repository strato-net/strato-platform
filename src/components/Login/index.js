import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';

class Login extends Component {

  render() {
    const { welcome } = this.props;
    return (
      <div>
        <h1> Login </h1>
      </div>
    );
  }
}

export default Login;
