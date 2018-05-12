import React, { Component } from 'react';
import { Button } from '@blueprintjs/core';
import { connect } from 'react-redux';

class Users extends Component {

  usersList() {
    return this.props.users.length && this.props.users.map((user, key) => {
      return (
        <tr key={key}>
          <td>
            {user.user && user.user.accountAddress}
          </td>
          <td>
            {user.status ? 'Not Found' : 'Member'}
            {user.status === 'Invited' && <Button>Approve</Button>}
          </td>
          <td>
            <Button>Connect</Button>
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
            <th><h5>Address</h5></th>
            <th><h5>Status</h5></th>
            <th><h5>Privacy</h5></th>
          </tr>
        </thead>

        <tbody>
          {this.usersList() || <tr><td colSpan={3}>No records found</td></tr>}
        </tbody>
      </table>
    )
  }
}

export function mapStateToProps(state) {
  return {};
}
const connected = connect(mapStateToProps)(Users);

export default connected;
