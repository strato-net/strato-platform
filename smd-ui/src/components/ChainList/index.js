import React, { Component } from 'react';
import { connect } from 'react-redux';
import { Field, reduxForm, reset } from 'redux-form';
import { clearQuery } from '../QueryEngine/queryEngine.actions';
import { withRouter } from 'react-router-dom';
import { Text, Position, Tooltip, Button } from '@blueprintjs/core';
import { parseDateFromString } from '../../lib/dateUtils';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import HexText from '../HexText';
import { fetchChains } from '../Chains/chains.actions';

class ChainList extends Component {
  constructor(props){
    super(props);
    this.state = {
      chainList: {
        default: {
          key: 'default',
          displayName: 'Choose a chain'
        },
      },
    };
  }

  componentDidMount() {
    this.props.fetchChains();
    if (this.state.chains && this.state.chains.chainLabels.length > 0){
      this.updateChainList(this.state.chains);
    }
  }

  updateQuery = (values) => {
    if (values.query && values.value) {
      this.props.updateQuery(values.query, values.value);
      this.props.dispatch(reset('transaction-query'));
    }
  }

  refresh = () => {
    this.props.clearQuery();
  };

  updateChainList = (chains) => {
    console.log("update");
    const chainList = this.state.chainList;
    chains.chainLabels.forEach(function(chainLabel, index){
      chainList.push({
        key: chains.chains[chainLabel],
        displayName: chainLabel
      });
    });
    this.setState({
      chainList: chainList
    })
  }

  render() {
    const chainList = this.state.chainList;
    const chains = this.props.chains;
    const history = this.props.history;
    const { handleSubmit } = this.props;

    function handleClick(hash) {
      mixpanelWrapper.track('choose_label_click');
      history.push('/transactions/' + hash);
    }

    const required = value => value ? undefined : 'Required'
    const queryForm =
      <div className="row smd-pad-4">
        <div className="col-sm-12">
          <form onSubmit={handleSubmit(this.updateQuery)}>
            <div className="pt-control-group smd-full-width">
              <div className="pt-select" id="tour-query-type">
                <Field
                  type="select"
                  component="select"
                  placeholder="Select a chain"
                  name="query"
                  validate={required}
                  required
                >
                  {
                    Object.getOwnPropertyNames(chainList).map(function (name) {
                      return <option key={name} value={chainList[name].key}>{chainList[name].displayName}</option>
                    })
                  }
                </Field>
              </div>
              <Button type="submit" onClick={() => {
                mixpanelWrapper.track('chain_label_submit');
              }}
                className="pt-intent-primary pt-icon-arrow-right" />
            </div>
          </form>
        </div>
      </div>

    return (
      <div>
        {queryForm}
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    chainList: state.chainList,
  };
}
const formed = reduxForm({ form: 'chain-list' })(ChainList);
const connected = connect(mapStateToProps, {
  fetchChains
})(formed);
export default withRouter(connected);
