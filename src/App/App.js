import React, { Component } from 'react';
import './App.css';

import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';
import 'bootstrap/dist/css/bootstrap.css'

import MenuBar from '../components/MenuBar'
import {routes, navLinksData} from '../routes';

class App extends Component {
  render() {
    return (
      <div className="App" id="outer-container">
        <MenuBar navLinksData={navLinksData} />
        <main id="page-wrap">
          {routes}
        </main>
      </div>
    );
  }
}

export default App;
