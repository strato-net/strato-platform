import React from 'react';
import { Route, Redirect } from 'react-router-dom';
import { withRouter } from 'react-router-dom';
import { currentUser } from '../../lib/localStorage';

class ProtectedRoute extends Route {

  render() {
    const component = super.render();

    if (!Object.keys(currentUser()).length) {
      return (<Redirect to={{
        pathname: '/apps',
        state: { from: this.props.location }
      }} />);
    }

    return component;
  }
}

export default withRouter(ProtectedRoute);