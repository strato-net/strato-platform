import React, { Component } from 'react';
import { connect } from 'react-redux';
import { fetchTx } from './transactions.actions';
import { withRouter } from 'react-router-dom';

class Transactions extends Component {

  componentDidMount() { //FIXME Put fetchTx on a timer?
    this.props.fetchTx();
  }

  render() {
    const txs = this.props.tx.map(
      (tx, i) => {
        return <li>tx #{i} of type {tx.transactionType}</li>
      }
    );
    return (
      <div>tx
        <ul>
          {txs}
        </ul>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    tx: state.transactions.tx
  };
}

export default withRouter(connect(mapStateToProps, { fetchTx })(Transactions));
