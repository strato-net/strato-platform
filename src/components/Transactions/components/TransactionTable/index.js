import React, {Component} from 'react';
import {connect} from 'react-redux';
import {fetchTx} from '../../../TransactionList/transactionList.actions';
import {withRouter} from 'react-router-dom';
import {Text, Position, Tooltip} from '@blueprintjs/core';
import * as moment from 'moment';
import mixpanel from 'mixpanel-browser';

class TransactionTable extends Component {

  componentDidMount() {
    this.props.fetchTx(15);
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
  }

  startPoll() {
    const fetchTx = this.props.fetchTx;
    this.timeout = setInterval(function () {
      fetchTx();
    }, 5000);
  }

  render() {
    const history = this.props.history;

    function handleClick(hash) {
      mixpanel.track('transactions_row_click');
      history.push('/transactions/' + hash);
    }

    let txRows = this.props.tx.map(
      function (tx, i) {
        return (
          <tr key={i} onClick={() => {
            handleClick(tx.hash)
          }}>
            <td width="40%">
              <Text ellipsize={true}>
                <Tooltip tooltipClassName="smd-padding-8" content={tx.hash} position={Position.TOP_LEFT}>
                  <small>{tx.hash}</small>
                </Tooltip>
              </Text>
            </td>
            <td width="10%">
              <Text ellipsize={true}>
                <Tooltip tooltipClassName="smd-padding-8" content={tx.value + ' wei'} position={Position.TOP_LEFT}>
                  <small>{tx.value} wei</small>
                </Tooltip>
              </Text>
            </td>
            <td width="10%">
              <Text ellipsize={true}>
                <small>
                  {tx.blockNumber}
                </small>
              </Text>
            </td>
            <td width="20%">
              <Text ellipsize={true}>
                <small>
                  {moment(tx.timestamp).format('YYYY-MM-DD hh:mm:ss A')}
                </small>
              </Text>
            </td>
            <td width="20%">
              <small>{tx.transactionType}</small>
            </td>
          </tr>
        )
      }
    );

    return (
      <div className="pt-card pt-dark pt-elevation-2">
        <div className="row">
          <div className="col-sm-12">
            <table className="pt-table pt-interactive pt-condensed pt-striped"
                   style={{tableLayout: 'fixed', width: "100%"}}>
              <thead>
              <tr>
                <th width="40%"><h5>Hash</h5></th>
                <th width="10%" className="text-right"><h5>Value</h5></th>
                <th width="10%"><h5>Block Number</h5></th>
                <th width="20%"><h5>Timestamp</h5></th>
                <th width="20%"><h5>Type</h5></th>
              </tr>
              </thead>

              <tbody>
              {txRows}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    tx: state.transactions.tx
  };
}

export default withRouter(connect(mapStateToProps, {fetchTx})(TransactionTable));
