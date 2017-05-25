import React from 'react';
import { Route, Switch } from 'react-router-dom';
import Dashboard from './components/Dashboard';

export const routes = (
  <Switch>
    <Route exact path="/" component={Dashboard}/>
  </Switch>
);

export const navLinksData = (
  [
    {path: '/', label: 'Dashboard', id: 'dashboard'},
    {path: '/test', label: 'Test', id: 'test'}
  ]
);