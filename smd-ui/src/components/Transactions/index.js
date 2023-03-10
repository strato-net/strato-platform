import React, { Component } from 'react';
import TransactionTable from './components/TransactionTable';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import Tour from '../Tour';
import ReactGA from 'react-ga4';
import { reduxForm } from 'redux-form';
import { selectChain } from '../Chains/chains.actions';
import { connect } from 'react-redux';

const tourSteps = [
  {
    title: 'Search your Transactions',
    text: 'Run search queries against all transactions launched by your Smart Contracts.',
    selector: '#tour-query-type',
    position: 'bottom', type: 'hover',
    isFixed: true,
  },
  {
    title: 'Add API endpoints to your application',
    text: '<strong>Bloc API</strong> offers a library of API endpoints you may use in any web application. Send and receive JSON data to your custom blockchains using <strong>Bloc API</strong>.',
    selector: '#tour-bloc-api-button',
    position: 'bottom', type: 'hover',
    isFixed: true,
  }
];

class Transactions extends Component {

  componentDidMount() {
    mixpanelWrapper.track("transactions_loaded");
    ReactGA.send({hitType: "pageview", page: "/transactions", title: "Transactions"});
  }
  
  render() {
    return (
      <div className="container-fluid pt-dark">
        <Tour steps={tourSteps} name="transactions" finalStepSelector='#tour-bloc-api-button' />
        <div className="row">
          <div className="col-sm-7">
            <h3>Transactions</h3>
          </div>
        </div>
        <TransactionTable />
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    chainIds: state.chains.chainIds,
    oauthUser: state.user.oauthUser
  };
}

const formed = reduxForm({ form: 'transactions' })(Transactions);
const connected = connect(mapStateToProps, {
  selectChain,
})(formed);

export default connected;
