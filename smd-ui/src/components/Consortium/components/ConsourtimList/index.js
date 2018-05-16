import React, { Component } from "react";
import { withRouter } from "react-router-dom";
import { connect } from "react-redux";
import { fetchEntities } from "../Entities/entities.actions";

class ConsourtimList extends Component {
  list() {
    return (
      this.props.consourtimList.length &&
      this.props.consourtimList.map((consourtim, key) => {
        return (
          <tr
            key={key}
            onClick={() => {
              this.props.history.push(`/consortium/${consourtim.networkId}/entities`);
              this.props.fetchEntities();
            }}
          >
            <td>{consourtim.networkId}</td>
            <td>{consourtim.name}</td>
            <td>{consourtim.description}</td>
          </tr>
        );
      })
    );
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

        <tbody>
          {this.list() || (
            <tr>
              <td colSpan={3}>No records found</td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }
}

export function mapStateToProps(state) {
  return {
    consourtimList: [
      { networkId: 1, name: 'Phone Manufacturing', description: 'A network of phone Manufacturing and retailers' }
    ]
  };
}

const connected = connect(mapStateToProps, { fetchEntities })(ConsourtimList);
export default withRouter(connected);
