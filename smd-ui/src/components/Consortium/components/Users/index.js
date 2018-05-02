import React, { Component } from 'react';
import { Button } from '@blueprintjs/core';

class Users extends Component {

  constructor(props) {
    super(props);
    this.state = {
      data: [
        { address: '03943893439220392', status: 'invited', privacy: "connect" },
        { address: '0394389343922', status: 'pending', privacy: "connect" },
        { address: '039438934392292', status: 'member', privacy: "connect" }
      ]
    }
  }

  tableData() {
    if (this.state.data && this.state.data.length) {
      return this.state.data.map((data, key) => {
        return (
          <tr key={key}>
            <td>
              {data.address}
            </td>
            <td>
              {data.status}
              <Button>Approve</Button>
            </td>
            <td>
              {data.privacy}
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

export default Users;