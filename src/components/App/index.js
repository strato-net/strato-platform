import React, { Component } from 'react';
import Toolbar from 'react-md/lib/Toolbars';
import Button from 'react-md/lib/Buttons';
import './App.css';

class App extends Component {
  render() {
    const nav = <Button key="nav" icon>menu</Button>
    return (
      <Toolbar colored title="Strato Management Dashboard" nav={nav} />
    );
  }
}

export default App;
