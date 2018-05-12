import React, { Component } from 'react';
import { Button } from '@blueprintjs/core';
import { connect } from 'react-redux';

class Nodes extends Component {

  nodes() {
    return this.props.nodes.length
      && this.props.nodes.map((node, key) => {
        return (
          <tr key={key}>
            <td>
              {node.public}
            </td>
            <td>
              {node.IP}
            </td>
            <td>
              {node.tcp}
            </td>
            <td>
              {node.udp}
            </td>
            <td>
              In-Sync
            </td>
          </tr>
        )
      })
  }

  render() {
    return (
      <table className="pt-table pt-interactive pt-condensed pt-striped"
        style={{ width: '100%' }}>
        <thead>
          <tr>
            <th><h5>Public Key</h5></th>
            <th><h5>IP</h5></th>
            <th><h5>TCP Port</h5></th>
            <th><h5>UDP Port</h5></th>
            <th><h5>Status</h5></th>
          </tr>
        </thead>

        <tbody>
          {this.nodes() || <tr><td colSpan={8}>No records found</td></tr>}
        </tbody>
      </table>
    )
  }

}

export function mapStateToProps(state) {
  return {
  };
}
const connected = connect(mapStateToProps)(Nodes);

export default connected;