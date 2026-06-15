import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import HexText from '../HexText';
import './accountDetail.css';
import { isOauthEnabled } from '../../lib/checkMode';

// Public mode is depricated now this component is used for OAUTH
class AccountDetail extends Component {
  render() {

    const isModeOauth = isOauthEnabled();
    const account = isModeOauth ? this.props.oauthAccount : this.props.account;

    return (
      <div className="pt-card address-margin-bottom">
        <div className="row smd-pad-2 smd-margin-4 smd-vertical-center">
          <div className="col-sm-10">
            <h4>
              Address: &nbsp;&nbsp; <HexText value={account ? account.address : ''} classes="smd-pad-2" />
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
              <td><strong>Balance</strong></td>
              <td>{account ? `${account.balance} wei` : ''}</td>
            </tr>
            <tr>
              <td><strong>Latest Block Number</strong></td>
              <td>{account ? account.latestBlockNum : ''}</td>
            </tr>
            <tr>
              <td><strong>Nonce</strong></td>
              <td>{account ? account.nonce : ''}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    account: state.accounts.currentAccountDetail,
    oauthAccount: state.oauthAccounts.account,
    name: state.oauthAccounts.name,
    selectedChain: state.chains.selectedChain,
  };
}

export default withRouter(
  connect(
    mapStateToProps,
  )(AccountDetail)
);
