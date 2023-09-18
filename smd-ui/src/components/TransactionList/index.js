import React, {Component} from 'react';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import './TransactionList.css'
import { Text } from '@blueprintjs/core';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { parseDateFromString } from '../../lib/dateUtils';
import HexText from '../HexText';
import { GET_TRANSACTIONS } from '../../sockets/rooms';
import { subscribeRoom, unSubscribeRoom } from '../../sockets/socket.actions'

class TransactionList extends Component {

  componentDidMount() {
    this.props.subscribeRoom(GET_TRANSACTIONS)
  }

  componentWillUnmount() {
    this.props.unSubscribeRoom(GET_TRANSACTIONS)
  }

  render() {
    const self = this;
    let txRows = this.props.transactions !== undefined && this.props.transactions.slice(0, 5).map(
      function (tx, i) {        
        return (
          <tr
            key={i}
            onClick={e => {mixpanelWrapper.track("dashboard_transaction_click"); self.props.history.push('/transactions/' + tx.hash)}}
          >
            <td width="40%">
              <HexText value={tx.hash} classes="small smd-pad-4"/>
            </td>
            <td width="23%" className="text-right">
              <small>{tx.value}</small>
            </td>
            <td width="22%">
              <Text ellipsize={true}>
                <small>
                  {parseDateFromString(tx.timestamp)}
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

        <h4>Recent Transactions (Main Chain)</h4>
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

export function mapStateToProps(state) {
  return {
    transactions: state.transactions.transactions
  };
}

export default withRouter(connect(mapStateToProps, {subscribeRoom,unSubscribeRoom})(TransactionList));
