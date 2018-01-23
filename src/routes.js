import React from 'react';
import { Route, Switch, Redirect } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Register from './components/Register';

export const routes = (
  <Switch>
    <Route exact path="/">
      <Redirect to="/dashboard" />
    </Route>
    <Route exact path="/login" component={ Login } />
    <Route exact path="/register" component={ Register } />
    <Route exact path="/dashboard" component={ Dashboard } />
  </Switch>
);
