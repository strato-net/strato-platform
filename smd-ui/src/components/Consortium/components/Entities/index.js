import React, { Component } from 'react';
import { Button } from '@blueprintjs/core';
import InviteEntity from './InviteEntity';

class Entities extends Component {

  constructor(props) {
    super(props);
    this.state = {
      data: []
    }
  }

  tableData() {
    if (this.state.data && this.state.data.length) {
      return this.state.data.map((data, key) => {
        return (
          <tr key={key}>
            <td>
              {data.one}
            </td>
            <td>
              {data.two}
            </td>
            <td>
              {data.three}
            </td>
            <td>
              {data.four}
              <Button>Vote</Button>
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

export default Entities;