import React from 'react';
import { Route, Switch, Redirect } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Register from './components/Register';
import Profile from './components/Profile';
import EnsureAuthenticated from './components/EnsureAuthenticated';

export const routes = (
  <Switch>
    <Route exact path="/">
      <Redirect to="/dashboard" />
    </Route>
    <EnsureAuthenticated path="/login" component={Login} />
    <EnsureAuthenticated path="/register" component={Register} />
    <Route path="/profile" component={Profile} />
    <Route path="/dashboard" component={Dashboard} />
  </Switch>
);
