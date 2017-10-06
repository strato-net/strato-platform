import React, {Component} from 'react';
import TransactionTable from './components/TransactionTable';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import Tour from '../Tour';
import { endTour } from '../Tour/tour.actions';
import { callAfterTour } from '../Tour/tour.helpers';
import { connect } from 'react-redux';

const tourSteps = [
  {
    title: 'Query Type',
    text: 'Where queries are to be found.',
    selector: '#tour-query-type',
    position: 'bottom', type: 'hover',
    isFixed: true,
  },
  {
    title: 'Bloc API',
    text: 'Button to the Bloc API',
    selector: '#tour-bloc-api-button',
    position: 'bottom', type: 'hover',
    isFixed: true,
  }
];

class Transactions extends Component {
  componentDidMount() {
    mixpanelWrapper.track("transactions_loaded");
  }

  render() {
    return (
      <div className="container-fluid pt-dark">
        <Tour steps={tourSteps} name="transactions" callback={callAfterTour('#tour-bloc-api-button',() => {
          this.props.endTour('transactions');
        })}/>
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

export default connect(state => { return {} }, {endTour})(Transactions);
