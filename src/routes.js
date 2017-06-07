import React from 'react';
import {Route, Switch, Redirect} from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Nodes from './components/Nodes';
import Blocks from './components/Blocks';
import Transactions from './components/Transactions';
import Accounts from './components/Accounts';
import Account from './components/Account';
import Contracts from './components/Contracts';
import SideBar from './components/SideBar';

export const routes = (
  <Switch>
    <Route exact path="/">
      <Redirect to="/dashboard" />
    </Route>
    <Route exact path="/dashboard" component={Dashboard}/>
    <Route exact path="/nodes" component={Nodes} />
    <Route exact path="/blocks" component={Blocks} />
    <Route exact path="/transactions" component={Transactions} />
    <Route exact path="/accounts" component={Accounts}/>
    <Route exact path="/accounts/:name/:address" component={Account} />
    <Route exact path="/contracts" component={Contracts}/>
    {
      // re-render sidebar on route change
    }
    <Route component={SideBar}/>
  </Switch>
);
