import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import HexText from '../HexText';
import './accountDetail.css';
import { env } from '../../env';
import { oauthFaucetRequest } from '../Accounts/components/OauthAccounts/oauthAccounts.actions';

// Public mode is depricated now this component is used for OAUTH
class AccountDetail extends Component {
  render() {

    const account = env.OAUTH_ENABLED ? this.props.oauthAccount : this.props.account;
    const faucetStatus = (this.props.faucet.accountAddress === account.address) && this.props.faucet.status;

    return (
      <div className="pt-card address-margin-bottom">
        <div className="row smd-pad-2 smd-margin-4 smd-vertical-center">
          <div className="col-sm-10">
            <h4>
              Address: &nbsp;&nbsp; <HexText value={account ? account.address : ''} classes="smd-pad-2" />
            </h4>
          </div>
          <div className="col-sm-2 text-right">
            <button
              className={`pt-button ${faucetStatus ? 'pt-intent-warning' : 'pt-intent-primary'} pt-small`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                this.props.oauthFaucetRequest(this.props.name, account.address, this.props.selectedChain);
              }}
              disabled={faucetStatus}
            >
              {faucetStatus ? 'Pending' : 'Faucet'}
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
              <td><strong>Contract Root</strong></td>
              <td><HexText value={account ? account.contractRoot : ''} classes="smd-pad-2" /></td>
            </tr>
            <tr>
              <td><strong>Kind</strong></td>
              <td>{account ? account.kind : ''}</td>
            </tr>
            <tr>
              <td><strong>Balance</strong></td>
              <td>{account ? `${account.balance} wei` : ''}</td>
            </tr>
            <tr>
              <td><strong>Latest Block Number</strong></td>
              <td>{account ? account.latestBlockNum : ''}</td>
            </tr>
            <tr>
              <td><strong>Code Hash</strong></td>
              <td><HexText value={account ? account.codeHash : ''} classes="smd-pad-2" /></td>
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
    currentUser: state.user.currentUser,
    selectedChain: state.chains.selectedChain,
    faucet: state.oauthAccounts.faucet,
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {
      oauthFaucetRequest
    }
  )(AccountDetail)
);
