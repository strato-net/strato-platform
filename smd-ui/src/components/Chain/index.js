import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import HexText from '../HexText';

class Chain extends Component {
  render() {
    const {
      label,
      id
    } = this.props;

    return (
      <div className="pt-card address-margin-bottom" key={label}>
        <div className="row smd-pad-2 smd-margin-4 smd-vertical-center">
          <div className="col-sm-10">
            <h4>
              Chain Id: &nbsp;&nbsp; <HexText value={id} classes="smd-pad-2" />
            </h4>
          </div>
          <div className="col-sm-2 text-right">
            <button
              className="pt-button pt-intent-primary pt-small"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}>
              Add Member
              </button>
            <button
              className="pt-button pt-intent-primary pt-small"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}>
              Remove Member
              </button>
          </div>
        </div>

        <table className="pt-table pt-str">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Add Rule</strong></td>
              <td>"placeholder"</td>
            </tr>
            <tr>
              <td><strong>Remove Rule</strong></td>
              <td>"placeholder"</td>
            </tr>
            <tr>
              <td><strong>Members</strong></td>
              <td>"placeholder"</td>
            </tr>
            <tr>
              <td><strong>Account Info</strong></td>
              <td>"placeholder"</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
}

export function mapStateToProps(state, ownProps) {
  const label = ownProps.label;
  const id = ownProps.id;
  const chainLabels = state.chains.chainLabels;
  const chainIds = state.chains.chainIds;
  const chains = state.chains.chains;
  return {
    chain: Object.getOwnPropertyNames(chains).indexOf(label) >= 0 ? state.chains.chains[label][id] : {},
  };
}

export default withRouter(
  connect(
    mapStateToProps,
  )(Chain)
);
