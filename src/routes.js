import React from 'react';
import { Route, IndexRedirect } from 'react-router';
import App from './components/App/';

import Accounts from './scenes/Accounts/';
import Blockchains from './scenes/Blockchains/';
import SmartContracts from './scenes/SmartContracts/';
import Networks from './scenes/Networks/';

export default (
  <Route path="/" component={App}>
    <IndexRedirect to="/networks" />
    <Route path="/networks" component={Networks} name="Home" icon="home" />
    <Route path="/smart-contracts" component={SmartContracts} name="Smart Contracts" icon="description" />
    <Route path="/blockchains" component={Blockchains} name="Blockchains" icon="view_module"/>
    <Route path="/accounts" component={Accounts} name="Accounts" icon="supervisor_account"/>
  </Route>
);
