import React from 'react';
import { Route, Redirect } from 'react-router-dom';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { parseJwt, readCookie } from '../../lib/parsejwt';
import { setCurrentUser } from '../User/user.actions';

class ProtectedRoute extends Route {
  
  componentDidMount() {
    let token = readCookie('token');

    if (!this.props.isLoggedIn && token) {
      let parsed = parseJwt(token);
      this.props.setCurrentUser(parsed);
      this.props.history.push('/home');
    }
  }

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
    currentUser: state.user.currentUser,
    isLoggedIn: state.user.isLoggedIn
  }
}

export default withRouter(
  connect(mapStateToProps, {
    setCurrentUser
  })(ProtectedRoute)
);