import React from 'react';
import { Route, Switch, Redirect } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Nodes from './components/Nodes';
import Blocks from './components/Blocks';
import Transactions from './components/Transactions';
import Accounts from './components/Accounts';
import Contracts from './components/Contracts';
import TransactionView from './components/Transactions/components/TransactionView';
import BlockView from './components/Blocks/components/BlockView';
import ContractQuery from './components/ContractQuery';
import App from './App';
import Applications from './components/Applications/';
import LaunchPad from './components/LaunchPad/';
import CodeEditor from './components/CodeEditor';
import ExternalStorage from './components/ExternalStorage';
import Chains from './components/Chains'

export const routes =
  <Switch>
    <Route exact path="/" component={App}>
      <Redirect to="/home" />
    </Route>
    <Route exact path="/home" component={Dashboard} />
    {/* TODO: remove app section */}
    {/* <Route exact path="/apps" component={Applications} /> */}
    <Route exact path="/accounts" component={Accounts} />
    <Route exact path="/external_storage" component={ExternalStorage} />
    <Route exact path="/nodes" component={Nodes} />
    <Route exact path="/blocks" component={Blocks} />
    <Route exact path="/blocks/:block" component={BlockView} />
    <Route exact path="/chains" component={Chains} />
    <Route exact path="/transactions" component={Transactions} />
    <Route exact path="/transactions/:hash" component={TransactionView} />
    <Route exact path="/contracts" component={Contracts} />
    <Route exact path="/contracts/:name/query" component={ContractQuery} />
    <Route exact path="/code_editor" component={CodeEditor} />
    <Route exact path="/launchpad" component={LaunchPad} />
  </Switch>