import React, { Component } from 'react';
import BlockTable from './components/BlockTable';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { connect } from 'react-redux';
import { selectChain, fetchChainIds } from '../Chains/chains.actions';
import { Field, reduxForm } from 'redux-form';

class Blocks extends Component {
  componentDidMount() {
    mixpanelWrapper.track('blocks_loaded');
  }

  render() {
    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-10">
            <h3>Blocks</h3>
          </div>
          <div className="col-sm-2 chain-wrapper">
            {this.props.chainIds && this.props.chainIds.length ?
              <div className="pt-select">
                <Field
                  className="pt-input select-chain"
                  component="select"
                  name="chainLabel"
                  onChange={
                    (e) => {
                      const data = e.target.value === 'Main Chain' ? null : e.target.value;
                      this.props.selectChain(data);
                    }
                  }
                  required
                >
                  <option> Main Chain </option>
                  {
                    this.props.chainIds.map((label, i) => {
                      return (
                        <option key={label.id} value={label.id}>{label.label}</option>
                      )
                    })
                  }
                </Field>
              </div> : ''}
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
    oauthUser: state.user.oauthUser
  };
}

const formed = reduxForm({ form: 'Blocks' })(Blocks);
const connected = connect(mapStateToProps, {
  selectChain,
  fetchChainIds
})(formed);

export default connected;
