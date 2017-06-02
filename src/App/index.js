import React, { Component } from 'react';
import MenuBar from '../components/MenuBar'
import SideBar from '../components/SideBar'
import {routes as scenes} from '../routes';

import './App.css';
import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';
import 'bootstrap/dist/css/bootstrap.css'


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
