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
import TransactionView from './components/Transactions/components/TransactionView';
import BlockView from './components/Blocks/components/BlockView';
import ContractQuery from './components/ContractQuery';
import CodeEditor from './components/CodeEditor';

export const routes = (
  <Switch>
    <Route exact path="/">
      <Redirect to="/home" />
    </Route>
    <Route exact path="/home" component={Dashboard}/>
    <Route exact path="/nodes" component={Nodes} />
    <Route exact path="/blocks" component={Blocks} />
    <Route exact path="/blocks/:block" component={BlockView} />
    <Route exact path="/transactions" component={Transactions} />
    <Route exact path="/transactions/:hash" component={TransactionView} />
    <Route exact path="/accounts" component={Accounts}/>
    <Route exact path="/accounts/:name/:address" component={Account} />
    <Route exact path="/contracts" component={Contracts}/>
    <Route exact path="/contracts/:name/query" component={ContractQuery} />
    <Route exact path="/code_editor" component={CodeEditor}/>
    <Route component={SideBar}/>
  </Switch>
);
