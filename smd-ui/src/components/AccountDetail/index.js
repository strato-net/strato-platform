import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import HexText from '../HexText';
import { faucetRequest, fetchCurrentAccountDetail } from '../Accounts/accounts.actions';
import './accountDetail.css';

class AccountDetail extends Component {

  componentDidMount() {
    this.props.fetchCurrentAccountDetail(this.props.address);
  }

  render() {
    const {
      address,
      account
    } = this.props;

    return (
      <div className="pt-card account-detail" key={address}>
        <div className="row smd-pad-2 smd-margin-4 smd-vertical-center">
          <div className="col-sm-12">
            <h4 className="heading">
              {this.props.username || ''}
            </h4>
          </div>
        </div>

        <table className="pt-table">
          <tbody>
            <tr>
              <td><strong>Address</strong></td>
              <td><HexText value={address} classes="smd-pad-2" /></td>
            </tr>
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
    account: state.accounts.currentAccountDetail
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    { faucetRequest, fetchCurrentAccountDetail }
  )(AccountDetail)
);
