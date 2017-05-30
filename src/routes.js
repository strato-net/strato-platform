import React from 'react';
import {Route, Switch} from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Accounts from './components/Accounts';

export const routes = (
  <Switch>
    <Route exact path="/" component={Dashboard}/>
    <Route exact path="/accounts" component={Accounts}/>
  </Switch>
);

export const navLinksData = (
  [
    {path: '/', label: 'Dashboard', id: 'dashboard', icon: "pt-icon-dashboard"},
    {path: '/accounts', label: 'Accounts', id: 'accounts', icon: "pt-icon-people"},
  ]
);