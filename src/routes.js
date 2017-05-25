import React from 'react';
import { Route, Switch } from 'react-router-dom';
import Dashboard from './components/Dashboard';
//import Test from './components/Test';
import Accounts from './components/Accounts';

export const routes = (
  <Switch>
    <Route exact path="/" component={Dashboard}/>
      <Route exact path="/accounts" component={Accounts}/>
  </Switch>
);

export const navLinksData = (
    [
        {path: '/', label: 'Dashboard', id: 'dashboard'},
        {path: '/accounts', label: 'Accounts', id: 'accounts'},
        {path: '/test', label: 'Test', id: 'test'}
    ]
);