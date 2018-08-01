import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import HexText from '../HexText';

class Chain extends Component {
  render() {
    const {
      label,
      id,
      chain
    } = this.props;
    console.log("cur chain");
    console.log(chain);
    return (
      <div className="pt-card address-margin-bottom" key={label}>
        <div className="row smd-pad-2 smd-margin-4 smd-vertical-center">
          <div className="col-sm-10">
            <h5>
              Chain Id: &nbsp;&nbsp; <HexText value={id} classes="smd-pad-2" />
            </h5>
          </div>
         {/* <div className="col-sm-4 text-right">
            <button
              className="pt-button pt-intent-primary pt-small"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}>
              Add Member
              </button>
          </div>
          <div className="col-sm-4 text-right">
            <button
              className="pt-button pt-intent-primary pt-small"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}>
              Remove Member
              </button>
          </div> */}
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
              <td><strong>Account Balances</strong></td>
              <td>{chain.accountInfo[0]["balance"]}</td>
            </tr>
            <tr>
              <td><strong>Members</strong></td>
              <td>{chain.members[0]}</td>
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
  const chains = state.chains.chains;
  console.log("All chains");
  console.log(chains);
  return {
    chain: Object.getOwnPropertyNames(chains).indexOf(label) >= 0 ? state.chains.chains[label][id] : {},
  };
}

export default withRouter(
  connect(
    mapStateToProps,
  )(Chain)
);
