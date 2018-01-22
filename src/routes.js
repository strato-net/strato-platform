import React from 'react';
import { Route, Switch, Redirect } from 'react-router-dom';

export const routes = (
  <Switch>
    <Route exact path="/">
      <Redirect to="/" />
    </Route>
  </Switch>
);
