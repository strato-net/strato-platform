import React from 'react';
import { Route, Redirect } from "react-router-dom";
import { env } from '../../env';

export default function EnsureAuthenticated({ component: Component, ...rest }) {
  return (
    <Route
      {...rest}
      render={(props) => localStorage.getItem(env.USERKEY)
        ? <Redirect to={{ pathname: '/dashboard', state: { from: props.location } }} />
        : <Component {...props} />}
    />
  )
}