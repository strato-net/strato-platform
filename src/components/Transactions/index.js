import React, {Component} from 'react';
import {connect} from 'react-redux';
import {fetchTx} from './transactions.actions';
import {withRouter} from 'react-router-dom';
import './Transactions.css'
import {Text} from '@blueprintjs/core';
import * as moment from 'moment';

class Transactions extends Component {

  componentDidMount() { //FIXME Put fetchTx on a timer?
    this.props.fetchTx();
  }

  render() {
    let txRows = this.props.tx.map(
      function (tx, i) {
        return (
            <tr key={i}>
              <td width="40%"><Text ellipsize={true}><small>{tx.hash}</small></Text></td>
              <td width="23%" className="text-right"><small>{tx.value}</small></td>
              <td width="22%">
                <small>
                  <Text ellipsize={true}>
                    {moment(tx.timestamp).format('YYYY-MM-DD hh:mm:ss A')}
                  </Text>
                </small>
              </td>
              <td width="15%"><small>{tx.transactionType}</small></td>
            </tr>
        )
      }
    );

    return (
      <div className="pt-card pt-dark pt-elevation-2">
        <table className="pt-table pt-interactive pt-condensed pt-striped" style={{tableLayout:'fixed'}}>
          <thead>
          <tr>
            <th width="40%"><h5>Hash</h5></th>
            <th className="text-right" width="23%"><h5>Value</h5></th>
            <th width="22%"><h5>Timestamp</h5></th>
            <th width="15%"><h5>Type</h5></th>
          </tr>
          </thead>

          <tbody>
          {txRows}
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

export default withRouter(connect(mapStateToProps, {fetchTx})(Transactions));
