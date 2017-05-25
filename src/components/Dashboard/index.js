import React, { Component } from 'react';
import TxList from "../TxList/index";

class Dashboard extends Component {
  render() {
    return (
      <div className="container">
        <TxList/>
      </div>
    );
  }
}

export default Dashboard;
