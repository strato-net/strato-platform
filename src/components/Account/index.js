import React, {Component} from 'react';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import {Button} from '@blueprintjs/core';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import HexText from '../HexText';

class Account extends Component {
  render() {
    const name = this.props.match.params.name;
    const account = this.props.account;
    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-9">
            <div className="h3">{name}</div>
            <div className="h4">
              <HexText value={account.address} classes="smd-pad-2"/>
            </div>
          </div>
          <div className="col-sm-3 smd-pad-16 text-right">
            <Button
              onClick={(e) => { mixpanelWrapper.track('account_view_go_back_click'); this.props.history.goBack();}}
              className="pt-icon-arrow-left"
              text="Back"
            />
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="pt-card">
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
                    <td><HexText value={account.contractRoot} classes="smd-pad-2"/></td>
                  </tr>
                  <tr>
                    <td><strong>Kind</strong></td>
                    <td>{account.kind}</td>
                  </tr>
                  <tr>
                    <td><strong>Balance</strong></td>
                    <td>{account.balance}</td>
                  </tr>
                  <tr>
                    <td><strong>Latest Block Number</strong></td>
                    <td>{account.latestBlockNum}</td>
                  </tr>
                  <tr>
                    <td><strong>Code Hash</strong></td>
                    <td><HexText value={account.codeHash} classes="smd-pad-2"/></td>
                  </tr>
                  <tr>
                    <td><strong>Nonce</strong></td>
                    <td>{account.nonce}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state, ownProps) {
  const name = ownProps.match.params.name;
  const address = ownProps.match.params.address;

  return {
    account: state.accounts.accounts[name][address],
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {}
  )(Account)
);
