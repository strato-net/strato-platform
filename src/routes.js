import React from 'react';
import {Route, Switch, Redirect} from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Accounts from './components/Accounts';
import Contracts from './components/Contracts';
import SideBar from './components/SideBar';

export const routes = (
  <Switch>
    <Route exact path="/">
      <Redirect to="/dashboard" />
    </Route>
    <Route exact path="/dashboard" component={Dashboard}/>
    <Route exact path="/accounts" component={Accounts}/>
    <Route exact path="/contracts" component={Contracts}/>
    {
      // re-render sidebar on route change
    }
    <Route component={SideBar}/>
  </Switch>
);
