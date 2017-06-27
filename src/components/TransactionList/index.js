import React, {Component} from 'react';
import {connect} from 'react-redux';
import {fetchTx} from './transactionList.actions';
import {withRouter} from 'react-router-dom';
import './TransactionList.css'
import {Text, Tooltip, Position} from '@blueprintjs/core';
import { env } from '../../env';
import * as moment from 'moment';
import mixpanelWrapper from '../../lib/mixpanelWrapper';

class TransactionList extends Component {

  componentDidMount() {
    this.props.fetchTx();
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
  }

  startPoll() {
    const fetchTx = this.props.fetchTx;
    this.timeout = setInterval(function () {
      fetchTx();
    }, env.POLLING_FREQUENCY);
  }

  render() {
    const self = this;
    let txRows = this.props.tx.slice(0, 5).map(
      function (tx, i) {
        return (
          <tr
            key={i}
            onClick={e => {mixpanelWrapper.track("dashboard_transaction_click"); self.props.history.push('/transactions/' + tx.hash)}}
          >
            <td width="40%">
              <Text ellipsize={true}>
                <Tooltip content={tx.hash} position={Position.TOP_LEFT}>
                  <small>{tx.hash}</small>
                </Tooltip>
              </Text>
            </td>
            <td width="23%" className="text-right">
              <small>{tx.value}</small>
            </td>
            <td width="22%">
              <Text ellipsize={true}>
                <small>
                  {moment(new Date(tx.timestamp)).format('YYYY-MM-DD hh:mm:ss A')}
                </small>
              </Text>
            </td>
            <td width="15%">
              <small>{tx.transactionType}</small>
            </td>
          </tr>
        )
      }
    );

    return (
      <div className="pt-card pt-dark pt-elevation-2">
        <table className="pt-table pt-interactive pt-condensed pt-striped" style={{tableLayout: 'fixed', width: '100%'}}>
          <thead>
          <tr>
            <th width="40%"><h5>Hash</h5></th>
            <th className="text-right" width="23%"><h5>Value</h5></th>
            <th width="22%"><h5>Timestamp</h5></th>
            <th width="15%"><h5>Type</h5></th>
          </tr>
          </thead>

          <tbody>
          {txRows.length === 0 ? <tr><td colSpan={5}>No Data</td></tr> : txRows}
          </tbody>
        </table>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    tx: state.transactions.tx
  };
}

export default withRouter(connect(mapStateToProps, {fetchTx})(TransactionList));
