import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';

class App extends Component {
  render() {
    return (
      <div className="App" >
        <main id="outer-container">
          <img src={logo} className="App-logo" alt="logo" />
        </main>
      </div>
    );
  }
}

export default App;
