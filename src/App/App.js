import React, { Component } from 'react';
import { routes as scenes } from '../routes';
import './App.css';

class App extends Component {
  render() {
    return (
      <section>
        {scenes}
      </section>
    );
  }
}

export default App;
