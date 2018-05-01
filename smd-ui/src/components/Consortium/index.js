import React, { Component } from 'react';
import { Button, Tabs2, Tab2 } from '@blueprintjs/core';
import Nodes from './components/Nodes';
import Admins from './components/Admins';
import Entities from './components/Entities';

class Consortium extends Component {
  constructor(props) {
    super(props);
    this.state = { navbarTab: 'entities' };
  }

  handleNavbarTabChange(navbarTab) {
    this.setState({ navbarTab });
  }

  renderComponent() {
    switch (this.state.navbarTab) {
      case 'nodes':
        return <Nodes />
      case 'admins':
        return <Admins />
      default:
        return <Entities />
    }
  }

  render() {
    return (
      <div className="container-fluid pt-dark consortium">
        <div className="row">
          <div className="col-md-4 text-left">
            <h3>Consortium</h3>
          </div>
          <div className="col-md-8 text-right">
            <Button text="Create New Consortium" className="smd-margin-16" />
          </div>
          <br />
        </div>
        <div className="row" >
          <div className="col-md-12 smd-margin-16">
            <Tabs2
              animate
              className="login-tabs"
              onChange={this.handleNavbarTabChange.bind(this)}
              selectedTabId={this.state.navbarTab}
            >
              <Tab2 id="entities" title="Entities" />
              <Tab2 id="nodes" title="Nodes" />
              <Tab2 id="admins" title="Admins" />
            </Tabs2>

            {this.renderComponent()}
          </div>
        </div>
      </div>
    )
  }
}

export default Consortium;