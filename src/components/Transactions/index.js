import React, {Component} from 'react';
import TransactionTable from './components/TransactionTable';
import mixpanel from 'mixpanel-browser';
class Transactions extends Component {
  componentDidMount() {
    mixpanel.track("transactions_loaded");
  }

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
