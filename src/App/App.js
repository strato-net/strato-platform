import React, { Component } from 'react';
import MenuBar from '../components/MenuBar'
import SideBar from '../components/SideBar'
import {routes as scenes, navLinksData} from '../routes';

import './App.css';
import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';
import 'bootstrap/dist/css/bootstrap.css'


class App extends Component {
  render() {
    return (
      <div className="App" id="outer-container">
        <SideBar navLinksData={navLinksData} />
        <main id="page-wrap">
          <MenuBar />
          <div className="container-fluid">
            {scenes}
          </div>
        </main>
      </div>
    );
  }
}

export default App;
