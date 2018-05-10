import React, { Component } from "react";
import { connect } from "react-redux";

class ConsourtimList extends Component {
  list() {
    if (this.props.consourtimList.length) {
      return this.props.nodes.map((consourtim, key) => {
        return (
          <tr key={key}>
            <td>{consourtim.networkId}</td>
            <td>{consourtim.name}</td>
            <td>{consourtim.description}</td>
          </tr>
        );
      });
    } else {
      return (
        <tr>
          <td colSpan={3}>No records found</td>
        </tr>
      );
    }
  }

  render() {
    return (
      <table
        className="pt-table pt-interactive pt-condensed pt-striped"
        style={{ width: "100%" }}
      >
        <thead>
          <tr>
            <th>
              <h5>Network ID</h5>
            </th>
            <th>
              <h5>Name</h5>
            </th>
            <th>
              <h5>Description</h5>
            </th>
          </tr>
        </thead>

        <tbody>{this.list()}</tbody>
      </table>
    );
  }
}

export function mapStateToProps(state) {
  return {
    consourtimList: []
  };
}
const connected = connect(mapStateToProps)(ConsourtimList);

export default connected;
