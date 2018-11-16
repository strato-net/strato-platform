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
import ProtectedRoute from './components/ProtectedRoute';
import Applications from './components/Applications/';
import LaunchPad from './components/LaunchPad/';
import CodeEditor from './components/CodeEditor';
import SideBar from './components/SideBar';
import AccountDetail from './components/AccountDetail';
import ExternalStorage from './components/ExternalStorage';
import Chains from './components/Chains'
import { isModePublic } from './lib/checkMode';

const CommonRoute = (props) => {
  const CommonRoute = props.route === 'public' ? Route : ProtectedRoute;

  return (<div>
    <CommonRoute exact path="/nodes" component={Nodes} />
    <CommonRoute exact path="/blocks" component={Blocks} />
    <CommonRoute exact path="/blocks/:block" component={BlockView} />
    <CommonRoute exact path="/chains" component={Chains} />
    <CommonRoute exact path="/transactions" component={Transactions} />
    <CommonRoute exact path="/transactions/:hash" component={TransactionView} />
    <CommonRoute exact path="/contracts" component={Contracts} />
    <CommonRoute exact path="/contracts/:name/query" component={ContractQuery} />
    <CommonRoute exact path="/code_editor" component={CodeEditor} />
    <CommonRoute exact path="/launchpad" component={LaunchPad} />
  </div>)
};

export const routes = isModePublic() ? (
  <Switch>
    <Route exact path="/" component={App}>
      <Redirect to="/apps" />
    </Route>
    <Route exact path="/apps" component={Applications} />
    <ProtectedRoute exact path="/home" component={Dashboard} />
    <ProtectedRoute exact path="/accounts" component={AccountDetail} />
    <CommonRoute route="protected" />
  </Switch>
) : (
    <Switch>
      <Route exact path="/">
        <Redirect to="/home" />
      </Route>
      <Route exact path="/home" component={Dashboard} />
      <Route exact path="/apps" component={Applications} />
      <Route exact path="/accounts" component={Accounts} />
      <Route exact path="/external_storage" component={ExternalStorage} />
      <CommonRoute route="public" />
      <Route component={SideBar} />
    </Switch>
  );