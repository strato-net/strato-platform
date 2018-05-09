import React, { Component } from 'react';
import { Button } from '@blueprintjs/core';
import { connect } from 'react-redux';

class Users extends Component {

  tableData() {
    if (this.props.users.length) {
      return this.props.users.map((user, key) => {
        return (
          <tr key={key}>
            <td>
              {user.address}
            </td>
            <td>
              {user.status}
              {user.status === 'Invited' && <Button>Approve</Button>}
            </td>
            <td>
              <Button>Connect</Button>
            </td>
          </tr>
        )
      })
    } else {
      return (
        <tr><td colSpan={3}>No records found</td></tr>
      )
    }
  }

  render() {
    return (
      <table className="pt-table pt-interactive pt-condensed pt-striped"
        style={{ width: '100%' }}>
        <thead>
          <tr>
            <th><h5>Address</h5></th>
            <th><h5>Status</h5></th>
            <th><h5>Privacy</h5></th>
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
  let users = [];
  if (state.createConsortium.consortium[0]) {
    state.createConsortium.consortium[0].entities.map(entity => {
      users.push(...entity.users);
    });
  }
  return {
    users
  };
}
const connected = connect(mapStateToProps)(Users);

export default connected;
