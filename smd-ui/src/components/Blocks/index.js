import React, { Component } from 'react';
import BlockTable from './components/BlockTable';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import ReactGA from 'react-ga4';
import { connect } from 'react-redux';
import { reduxForm } from 'redux-form';
class Blocks extends Component {
  
  componentDidMount() {
    mixpanelWrapper.track('blocks_loaded');
    ReactGA.send({hitType: "pageview", page: "/blocks", title: "Blocks"});
  }

  render() {
    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-6">
            <h3>Blocks</h3>
          </div>
        </div>
        <BlockTable />
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    chainIds: state.chains.chainIds,
  };
}

const formed = reduxForm({ form: 'Blocks' })(Blocks);
const connected = connect(mapStateToProps, {})(formed);

export default connected;
