import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button } from '@blueprintjs/core';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { fetchTx } from '../../../TransactionList/transactionList.actions';
import HexText from '../../../HexText';
import { parseDateFromString } from '../../../../lib/dateUtils';

class TransactionView extends Component {
  componentDidMount() {
    // let chainId = this.props.match.params.chainId === 'null' ? null : this.props.match.params.chainId;
    this.props.fetchTx(null, this.props.selectedChain);
  }

  render() {
    const hash = this.props.match.params.hash;
    const tx = this.props.tx;
    if (tx) {
      return (
        <div className="container-fluid pt-dark">
          <div className="row">
            <div className="col-sm-9">
              <div className="h3">
                <HexText value={hash} classes="smd-pad-2" />
              </div>
            </div>
            <div className="col-sm-3 smd-pad-16 text-right">
              <Button
                onClick={(e) => { mixpanelWrapper.track("transactions_view_go_back_click"); this.props.history.goBack() }}
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
                      <td><strong>Value</strong></td>
                      <td>{tx.value === undefined ? '' : tx.value}</td>
                    </tr>
                    <tr>
                      <td><strong>From</strong></td>
                      <td>{tx.from === undefined ? '' : <HexText value={tx.from} classes="smd-pad-2" />}</td>
                    </tr>
                    <tr>
                      <td><strong>To</strong></td>
                      <td>{tx.to === undefined ? '' : <HexText value={tx.to} classes="smd-pad-2" />}</td>
                    </tr>
                    <tr>
                      <td><strong>Block Number</strong></td>
                      <td>{tx.blockNumber}</td>
                    </tr>
                    <tr>
                      <td><strong>R</strong></td>
                      <td><HexText value={tx.r} classes="smd-pad-2" /></td>
                    </tr>
                    <tr>
                      <td><strong>S</strong></td>
                      <td><HexText value={tx.s} classes="smd-pad-2" /></td>
                    </tr>
                    <tr>
                      <td><strong>Timestamp</strong></td>
                      <td>{parseDateFromString(tx.timestamp)}</td>
                    </tr>
                    <tr>
                      <td><strong>V</strong></td>
                      <td>{tx.v}</td>
                    </tr>
                    <tr>
                      <td><strong>Nonce</strong></td>
                      <td>{tx.nonce}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      );
    }
    else {
      return <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-9">
            <div className="h3">ERROR</div>
          </div>
          <div className="col-sm-3 smd-pad-16 text-right">
            <Button
              onClick={(e) => { mixpanelWrapper.track("transactions_view_go_back_click"); this.props.history.goBack() }}
              className="pt-icon-arrow-left"
              text="Back"
            />
          </div>
        </div>
      </div>
    }
  }
}

export function mapStateToProps(state, ownProps) {
  const hash = ownProps.match.params.hash;
  return {
    selectedChain: state.chains.selectedChain,
    tx: state.transactions.tx.filter((val) => { return val.hash === hash })[0] || state.queryEngine.queryResult.filter((val) => { return val.hash === hash })[0]
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    { fetchTx }
  )(TransactionView)
);
