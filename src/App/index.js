import React, { Component } from 'react';
import MenuBar from '../components/MenuBar'
import SideBar from '../components/SideBar'
import {routes as scenes} from '../routes';
import mixpanel from 'mixpanel-browser';
import './App.css';
import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';
import 'bootstrap/dist/css/bootstrap.css'
import {NODES} from '../env';

mixpanel.init('62f1bec01cdb0096be8e8bdd693e0081');
mixpanel.identify(NODES[0].NODE_NAME);

class App extends Component {
  render() {
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
