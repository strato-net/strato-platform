import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import HexText from '../HexText';

class Account extends Component {
  render() {
    const {
      name,
      address,
      account
    } = this.props;

    return (
      <div className="pt-card address-margin-bottom" key={address}>
        <div className="row smd-pad-2 smd-margin-4 smd-vertical-center">
          <div className="col-sm-10">
            <h4>
              Address: &nbsp;&nbsp; <HexText value={address} classes="smd-pad-2" />
            </h4>
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
              <td><strong>Contract Root</strong></td>
              <td><HexText value={account.contractRoot} classes="smd-pad-2" /></td>
            </tr>
            <tr>
              <td><strong>Kind</strong></td>
              <td>{account.kind}</td>
            </tr>
            <tr>
              <td><strong>Balance</strong></td>
              <td>{account.balance && `${account.balance} wei`}</td>
            </tr>
            <tr>
              <td><strong>Latest Block Number</strong></td>
              <td>{account.latestBlockNum}</td>
            </tr>
            <tr>
              <td><strong>Code Hash</strong></td>
              <td><HexText value={account.codeHash} classes="smd-pad-2" /></td>
            </tr>
            <tr>
              <td><strong>Nonce</strong></td>
              <td>{account.nonce}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
}

export function mapStateToProps(state, ownProps) {
  const name = ownProps.name;
  const address = ownProps.address;
  const accounts = state.accounts.accounts;
  return {
    account: Object.getOwnPropertyNames(accounts).indexOf(name) >= 0 ? state.accounts.accounts[name][address] : {},
  };
}

export default withRouter(
  connect(
    mapStateToProps,
  )(Account)
);
