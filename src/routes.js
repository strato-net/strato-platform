import React from 'react';
import {Route, Switch} from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Accounts from './components/Accounts';
import Contracts from './components/Contracts';

export const routes = (
  <Switch>
    <Route exact path="/" component={Dashboard}/>
    <Route exact path="/accounts" component={Accounts}/>
    <Route exact path="/contracts" component={Contracts}/>
  </Switch>
);

export const navLinksData = (
  [
    {path: '/', label: 'Dashboard', id: 'dashboard', icon: "pt-icon-dashboard"},
    {path: '/accounts', label: 'Accounts', id: 'accounts', icon: "pt-icon-people"},
    {path: '/contracts', label: 'Contracts', id: 'contracts', icon: "pt-icon-projects"},
  ]
);