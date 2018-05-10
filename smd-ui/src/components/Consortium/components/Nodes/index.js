import React, { Component } from 'react';
import { Button } from '@blueprintjs/core';
import { connect } from 'react-redux';

class Nodes extends Component {

  tableData() {
    if (this.props.nodes.length) {
      return this.props.nodes.map((node, key) => {
        return (
          <tr key={key}>
            <td>
              {node.owner}
            </td>
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
              {node.invitedBy}
            </td>
            <td>
              {node.status}
            </td>
            <td>
              <Button>Remove</Button>
            </td>
          </tr>
        )
      })
    } else {
      return (
        <tr><td colSpan={8}>No records found</td></tr>
      )
    }
  }

  render() {
    return (
      <table className="pt-table pt-interactive pt-condensed pt-striped"
        style={{ width: '100%' }}>
        <thead>
          <tr>
            <th><h5>Owner</h5></th>
            <th><h5>Public Key</h5></th>
            <th><h5>IP</h5></th>
            <th><h5>TCP Port</h5></th>
            <th><h5>UDP Port</h5></th>
            <th><h5>Invited By</h5></th>
            <th><h5>Status</h5></th>
            <th><h5>Options</h5></th>
          </tr>
        </thead>

        <tbody>
          {this.tableData()}
        </tbody>
      </table>
    )
  }

}

export function mapStateToProps(state) {
  let nodes = [];
  if (state.createConsortium.consortium[0]) {
    state.createConsortium.consortium[0].entities.forEach(entity => {
      nodes.push(...entity.nodes);
    });
  }
  return {
    nodes
  };
}
const connected = connect(mapStateToProps)(Nodes);

export default connected;