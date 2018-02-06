import React from 'react';
import { Route, Switch, Redirect } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Nodes from './components/Nodes';
import Blocks from './components/Blocks';
import Transactions from './components/Transactions';
import Accounts from './components/Accounts';
import Account from './components/Account';
import Contracts from './components/Contracts';
import TransactionView from './components/Transactions/components/TransactionView';
import BlockView from './components/Blocks/components/BlockView';
import ContractQuery from './components/ContractQuery';
import App from './App';
import ProtectedRoute from './components/ProtectedRoute';
import Applications from './components/Applications/';
import LaunchPad from './components/LaunchPad/';
import CodeEditor from './components/CodeEditor';

export const routes = (
  <Switch>
    <Route exact path="/" component={App}>
      <Redirect to="/apps" />
    </Route>
    <Route exact path="/launchpad" component={LaunchPad} />
    <Route exact path="/apps" component={Applications} />
    <ProtectedRoute exact path="/home" component={Dashboard} />
    <ProtectedRoute exact path="/nodes" component={Nodes} />
    <ProtectedRoute exact path="/blocks" component={Blocks} />
    <ProtectedRoute exact path="/blocks/:block" component={BlockView} />
    <ProtectedRoute exact path="/transactions" component={Transactions} />
    <ProtectedRoute exact path="/transactions/:hash" component={TransactionView} />
    <ProtectedRoute exact path="/accounts" component={Accounts} />
    <ProtectedRoute exact path="/accounts/:name/:address" component={Account} />
    <ProtectedRoute exact path="/contracts" component={Contracts} />
    <ProtectedRoute exact path="/contracts/:name/query" component={ContractQuery} />
    <ProtectedRoute exact path="/code_editor" component={CodeEditor} />
  </Switch>
);