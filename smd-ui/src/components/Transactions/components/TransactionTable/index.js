import React, { Component } from 'react';
import { connect } from 'react-redux';
import { Field, reduxForm, reset } from 'redux-form';
import { TRANSACTION_QUERY_TYPES, RESOURCE_TYPES } from '../../../QueryEngine/queryTypes';
import { updateQuery, clearQuery, executeQuery, removeQuery} from '../../../QueryEngine/queryEngine.actions';
import { withRouter } from 'react-router-dom';
import { Text, Position, Tooltip, Button } from '@blueprintjs/core';
import { parseDateFromString } from '../../../../lib/dateUtils';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { fetchTx } from '../../../TransactionList/transactionList.actions';
import HexText from '../../../HexText';

class TransactionTable extends Component {
  componentDidMount() {
    this.props.fetchTx(null, this.props.selectedChain);
    this.props.executeQuery(RESOURCE_TYPES.transaction, this.props.query, this.props.selectedChain);
  }

  componentWillReceiveProps(newProps) {
    if (newProps.query !== this.props.query) {
      newProps.executeQuery(RESOURCE_TYPES.transaction, newProps.query, newProps.selectedChain);
    }
    if (newProps.selectedChain !== this.props.selectedChain) {
      this.props.fetchTx(null, newProps.selectedChain);
      newProps.executeQuery(RESOURCE_TYPES.transaction, newProps.query, newProps.selectedChain);
    }
  }

  updateQuery = (values) => {
    if (values.query && values.value) {
      this.props.updateQuery(values.query, values.value);
      this.props.dispatch(reset('transaction-query'));
    }
  }

  // dispatchSubmit = () => {
  //   this.props.dispatch(submit('transaction-query'));
  // }

  refresh = () => {
    this.props.clearQuery();
    this.props.executeQuery(RESOURCE_TYPES.transaction, this.props.query, this.props.selectedChain);
  };
  
  render() {
    const { handleSubmit, history} = this.props; 
    const handleClick = function(hash) {
      mixpanelWrapper.track('transactions_row_click');
      history.push(`/transactions/${hash}`);
    }
    let txRows = this.props.queryResults.length && this.props.queryResults[0]['transactionType'] && this.props.queryResults.map(
      function (tx, i) {
        return (
          <tr key={i} onClick={() => {
            handleClick(tx.hash)
          }}>
            <td width="40%">
              <HexText value={tx.hash} classes="small smd-pad-4" />
            </td>
            <td width="10%">
              <Text ellipsize={true}>
                <Tooltip tooltipClassName="smd-padding-8" content={tx.value + ' wei'} position={Position.TOP_LEFT}>
                  <small>{tx.value} wei</small>
                </Tooltip>
              </Text>
            </td>
            <td width="10%">
              <Text ellipsize={true}>
                <small>
                  {tx.blockNumber}
                </small>
              </Text>
            </td>
            <td width="20%">
              <Text ellipsize={true}>
                <small>
                  {parseDateFromString(tx.timestamp)}
                </small>
              </Text>
            </td>
            <td width="20%">
              <small>{tx.transactionType}</small>
            </td>
          </tr>
        )
      }
    );

    const required = value => value ? undefined : 'Required'
    const queryTypes = TRANSACTION_QUERY_TYPES;
    const queryForm =
      <div className="row smd-pad-4">
        <div className="col-sm-12">
          <form onSubmit={handleSubmit(this.updateQuery)}>
            <div className="pt-control-group smd-full-width">
              <div className="pt-select" id="tour-query-type">
                <Field
                  type="select"
                  component="select"
                  placeholder="Query Type"
                  name="query"
                  validate={required}
                  required
                >
                  {
                    Object.getOwnPropertyNames(queryTypes).map(function (name) {
                      return <option key={name} value={queryTypes[name].key}>{queryTypes[name].displayName}</option>
                    })
                  }
                </Field>
              </div>
              <div className="smd-input-width">
                <Field
                  type="text"
                  className="pt-input pt-fill"
                  component="input"
                  name="value"
                  placeholder="Query Term"
                  validate={required}
                  onKeyPress={
                    (e) => {
                      if (e.key === 'Enter') {
                        //this.dispatchSubmit();
                        mixpanelWrapper.track('transactions_query_submit');
                      }
                    }
                  }
                  dir="auto" />
              </div>
              <Button type="submit" onClick={() => {
                //this.dispatchSubmit();
                mixpanelWrapper.track('transactions_query_submit');
              }}
                className="pt-intent-primary pt-icon-arrow-right" />
            </div>
          </form>
        </div>
      </div>

    const query = this.props.query;
    const removeQuery = this.props.removeQuery;
    const tags = Object.getOwnPropertyNames(query).map((queryType, i) => {
      const queryValue = query[queryType];
      return (
        <span key={'tag-' + queryType + '-' + i} className="pt-tag pt-tag-removable smd-margin-right-4">
          {queryType + ': ' + queryValue}
          <button onClick={() => {
            removeQuery(queryType);
            mixpanelWrapper.track('transactions_query_remove_tag');
          }} className="pt-tag-remove" />
        </span>
      )
    });

    const queries =
      <div>
        {queryForm}
        <div className="row smd-pad-4">
          <div className="col-sm-12">
            {tags}
          </div>
        </div>
      </div>

    return (
      <div className="pt-card pt-dark pt-elevation-2">
        <div className="row smd-pad-4">
          <div className="col-sm-11 text-left">
            <span className="h3">Query Builder</span>
          </div>
          <div className="col-sm-1 text-right">
            <Button onClick={this.refresh} className="pt-intent-primary pt-icon-refresh" />
          </div>
        </div>

        {queries}

        <div className="row">
          <div className="col-sm-12">
            <table className="pt-table pt-interactive pt-condensed pt-striped"
              style={{ tableLayout: 'fixed', width: "100%" }}>
              <thead>
                <tr>
                  <th width="40%"><h5>Hash</h5></th>
                  <th width="10%" className="text-right"><h5>Value</h5></th>
                  <th width="10%"><h5>Block Number</h5></th>
                  <th width="20%"><h5>Timestamp</h5></th>
                  <th width="20%"><h5>Type</h5></th>
                </tr>
              </thead>

              <tbody>
                {!txRows ? <tr>
                  <td colSpan={5}>No Data</td>
                </tr> : txRows}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );

  }
}

export function mapStateToProps(state) {
  return {
    query: state.queryEngine.query,
    queryResults: state.queryEngine.queryResult,
    selectedChain: state.chains.selectedChain
  };
}
const formed = reduxForm({ form: 'transaction-query' })(TransactionTable);
const connected = connect(mapStateToProps, {
  updateQuery,
  removeQuery,
  executeQuery,
  clearQuery,
  fetchTx
})(formed);
export default withRouter(connected);
