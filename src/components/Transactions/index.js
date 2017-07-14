import React, {Component} from 'react';
import TransactionTable from './components/TransactionTable';
import mixpanelWrapper from '../../lib/mixpanelWrapper';

class Transactions extends Component {
  componentDidMount() {
    mixpanelWrapper.track("transactions_loaded");
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
