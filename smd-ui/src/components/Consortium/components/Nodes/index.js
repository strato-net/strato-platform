import React, { Component } from 'react';
import { Button } from '@blueprintjs/core';

class Nodes extends Component {

  constructor(props) {
    super(props);
    this.state = {
      data: [
        { owner: 'microsoft', IP: '3', public: '2', tcp: 8080, udp: 10001, invitedBy: 'Company 2', status: 'In-Sync', options: 'remove' },
        { owner: 'microsoft', IP: '3', public: '2', tcp: 8080, udp: 10001, invitedBy: 'Company 2', status: 'In-Sync', options: 'remove' },
        { owner: 'microsoft', IP: '3', public: '2', tcp: 8080, udp: 10001, invitedBy: 'Company 2', status: 'In-Sync', options: 'remove' },
      ]
    }
  }

  tableData() {
    if (this.state.data && this.state.data.length) {
      return this.state.data.map((data, key) => {
        return (
          <tr key={key}>
            <td>
              {data.owner}
            </td>
            <td>
              {data.IP}
            </td>
            <td>
              {data.public}
            </td>
            <td>
              {data.tcp}
            </td>
            <td>
              {data.udp}
            </td>
            <td>
              {data.invitedBy}
            </td>
            <td>
              {data.status}
            </td>
            <td>
              <Button>{data.options}</Button>
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
            <th><h5>IP</h5></th>
            <th><h5>Public Key</h5></th>
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

export default Nodes;