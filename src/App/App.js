import React, { Component } from 'react';
import Difficulty from '../components/Difficulty';
import './App.css';

// Blueprint css
import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';

class App extends Component {
  render() {
    return (
      <div className="App">
        To get started, edit <code>src/App/App.js</code> and save to reload.
        {this.props.children}
      </div>
    );
  }
}

export default App;
