import React, { Component } from 'react';
import { Button } from '@blueprintjs/core';
import { connect } from 'react-redux';
import InviteEntity from './InviteEntity';

class Entities extends Component {

  tableData() {
    const entities = this.props.createConsortium.consortium[0]
      ? this.props.createConsortium.consortium[0].entities
      : []
    if (entities.length) {
      return entities.map((entity, key) => {
        return (
          <tr key={key}>
            <td>
              {entity.name}
            </td>
            <td>
              {entity.nodes ? entity.nodes.length : 0}
            </td>
            <td>
              {entity.users ? entity.users.length : 0}
            </td>
            <td>
              {entity.status}
              {entity.status === 'Pending' && <Button>Vote</Button>}
            </td>
            <td>
              <Button>Connect</Button>
            </td>
          </tr>
        )
      })
    } else {
      return (
        <tr><td colSpan={5}>No records found</td></tr>
      )
    }
  }

  render() {
    return (
      <div>
        <div className="text-right">
          <InviteEntity />
        </div>
        <table className="pt-table pt-interactive pt-condensed pt-striped"
          style={{ width: '100%' }}>
          <thead>
            <tr>
              <th><h5>Member</h5></th>
              <th><h5>Nodes</h5></th>
              <th><h5>Users</h5></th>
              <th><h5>Status</h5></th>
              <th><h5>Privacy</h5></th>
            </tr>
          </thead>

          <tbody>
            {this.tableData()}
          </tbody>
        </table>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    createConsortium: state.createConsortium
  };
}
const connected = connect(mapStateToProps)(Entities);

export default connected;