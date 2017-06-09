import React, {Component} from 'react';
import TransactionTable from './components/TransactionTable';

class Transactions extends Component {
  render() {
    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-12">
            <h3>Transactions</h3>
          </div>
        </div>
        <TransactionTable/>
      </div>
    );
  }
}

export default Transactions;
