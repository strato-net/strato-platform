import React, { Component } from 'react';
import MenuBar from '../components/MenuBar'
import SideBar from '../components/SideBar'
import {routes as scenes} from '../routes';
import mixpanelWrapper from '../lib/mixpanelWrapper';
import './App.css';
import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';
import '@blueprintjs/table/dist/table.css';
import 'bootstrap/dist/css/bootstrap.css';
import { env } from '../env';

mixpanelWrapper.init('62f1bec01cdb0096be8e8bdd693e0081');
mixpanelWrapper.identify(env.NODE_NAME);

const tourCallback = function tourCallback(trigger) {
  if(trigger.type === 'step:after') {
    // Route to
    switch(trigger.step.selector) {
        case '#accounts': {
            this.props.history.push('accounts');
        }
        case '#transactions': {
            this.props.history.push('transactions');
        }
    }
  }
};

class App extends Component {
  render() {
    const tour = this.props.tour;

    return (
      <div className="App" >
        <MenuBar />
        <SideBar />
        <main id="outer-container">
          {scenes}
        </main>
      </div>
    );
  }
}

export default App;
