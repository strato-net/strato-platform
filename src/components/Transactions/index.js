import React, {Component} from 'react';
import {connect} from 'react-redux';
import {fetchTx} from './transactions.actions';
import {withRouter} from 'react-router-dom';
import './Transactions.css'
import {Text} from '@blueprintjs/core';

class Transactions extends Component {

  componentDidMount() { //FIXME Put fetchTx on a timer?
    this.props.fetchTx();
  }

  render() {
    let txRows = this.props.tx.map(
      function (tx, i) {
        return (
            <tr key={i}>
              <td width="50%"><Text ellipsize={true}><small>{tx.hash}</small></Text></td>
              <td width="30%" className="text-right"><small>{tx.value}</small></td>
              <td width="20%"><small>{tx.transactionType}</small></td>
            </tr>
        )
      }
    );

    return (
      <div className="pt-card pt-dark pt-elevation-2">
        <table className="pt-table pt-interactive pt-condensed pt-striped">
          <thead>
          <th width="50%"><h5>Hash</h5></th>
          <th className="text-right" width="30%"><h5>Value</h5></th>
          <th width="20%"><h5>Type</h5></th>
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
