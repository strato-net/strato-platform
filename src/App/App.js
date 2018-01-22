import React, { Component } from 'react';
import logo from './logo.svg';
import { routes as scenes } from '../routes';
import './App.css';

class App extends Component {
  render() {
    return (
      <div className="App" >
        <main id="outer-container">
          {scenes}
        </main>
      </div>
    );
  }
}

export default App;
