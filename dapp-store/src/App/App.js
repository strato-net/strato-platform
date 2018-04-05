import React, { Component } from 'react';
import { routes as scenes } from '../routes';
import './App.css';
import LoadingBar from 'react-redux-loading-bar'

class App extends Component {
  render() {
    return (
      <section>
        <LoadingBar style={{top: '0px', backgroundColor: '#62d96b', zIndex: 999, height: '4px'}} />
        {scenes}
      </section>
    );
  }
}

export default App;
