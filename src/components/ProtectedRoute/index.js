import React from 'react';
import { Route, Redirect } from 'react-router-dom';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { parseJwt, readCookie } from '../../lib/parsejwt';

class ProtectedRoute extends Route {

  render() {
    const component = super.render();

    if(!this.props.isLoggedIn) {
      return (<Redirect to={{
        pathname: '/login',
        state: { from: this.props.location }
      }} />);
    }

    return component;
  }
}

function mapStateToProps(state) {
  return {
    login: state.login,
    currentUser: state.account.currentUser,
    isLoggedIn: state.account.isLoggedIn
  }
}

export default withRouter(
  connect(mapStateToProps, {

  })(ProtectedRoute)
);