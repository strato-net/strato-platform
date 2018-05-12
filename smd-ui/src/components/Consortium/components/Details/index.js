import React, { Component } from 'react';
import { Button, Tabs2, Tab2 } from '@blueprintjs/core';
import { connect } from 'react-redux';
import Nodes from "./Nodes";
import Users from "./Users";
import './details.css';
import { fetchEntityRequest } from './details.actions';

class Details extends Component {
  constructor(props) {
    super(props);
    this.state = { navbarTab: "nodes" };
  }

  handleNavbarTabChange(navbarTab) {
    this.setState({ navbarTab });
  }

  componentDidMount() {
    if (this.props.match.params && this.props.match.params.id)
      this.props.fetchEntityRequest(this.props.match.params.id);
  }

  renderComponent() {
    let node = this.props.entity && this.props.entity.Users[0] ?
      [{ public: this.props.entity.Users[0].EntityId, IP: `192.168.1.${this.props.entity.Users[0].id}`, tcp: `805${this.props.entity.Users[0].id}`, udp: `808${this.props.entity.Users[0].id}` }] : [];
    switch (this.state.navbarTab) {
      case "nodes":
        return <Nodes nodes={node} />;
      default:
        return <Users users={this.props.entity.Users} />;
    }
  }

  render() {
    return (
      <div className="container-fluid pt-dark consortium">
        <div className="row">
          <div className="col-md-8">
            <h3>{this.props.entity && this.props.entity.name}</h3>
          </div>
          <div className="col-md-4 text-right">
            <Button
              onClick={(e) => { this.props.history.goBack() }}
              className="pt-icon-arrow-left back-button"
              text="Back"
            />
          </div>
        </div>
        <div className="row">
          <div className="col-md-12">
            <Tabs2
              animate
              className="login-tabs"
              onChange={this.handleNavbarTabChange.bind(this)}
              selectedTabId={this.state.navbarTab}
            >
              <Tab2 id="nodes" title="Nodes" />
              <Tab2 id="users" title="Users" />
            </Tabs2>

            {this.renderComponent()}
          </div>
        </div>
      </div>
    )
  }

}

export function mapStateToProps(state) {
  return {
    entity: state.entity.entity
  };
}
const connected = connect(mapStateToProps, { fetchEntityRequest })(Details);

export default connected;