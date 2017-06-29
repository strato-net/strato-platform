import React, {Component} from 'react';
import {connect} from 'react-redux';
import {Field} from 'redux-form';
import {fetchTx} from '../../../TransactionList/transactionList.actions';
import {addQuery} from './transactionTable.actions';
import {withRouter} from 'react-router-dom';
import {Text, Position, Tooltip, Button} from '@blueprintjs/core';
import {env} from '../../../../env';
import * as moment from 'moment';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';

class TransactionTable extends Component {

  componentDidMount() {
    this.props.fetchTx(15);
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
  }

  startPoll() {
    const fetchTx = this.props.fetchTx;
    this.timeout = setInterval(function () {
      fetchTx();
    }, env.POLLING_FREQUENCY);
  }

  render() {
    const history = this.props.history;

    function handleClick(hash) {
      mixpanelWrapper.track('transactions_row_click');
      history.push('/transactions/' + hash);
    }

    let txRows = this.props.tx.map(
      function (tx, i) {
        return (
          <tr key={i} onClick={() => {
            handleClick(tx.hash)
          }}>
            <td width="40%">
              <Text ellipsize={true}>
                <Tooltip tooltipClassName="smd-padding-8" content={tx.hash} position={Position.TOP_LEFT}>
                  <small>{tx.hash}</small>
                </Tooltip>
              </Text>
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
                  {moment(tx.timestamp).format('YYYY-MM-DD hh:mm:ss A')}
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

    const queries = [queryItem];

    const queryTypes = this.props.queryTypes;
    const queryItem =
      <div className="row">
        <div className="col-sm-4">
          <Field
            className="pt-input"
            component="select"
            name="query"
            onChange={this.handleUsernameChange}
            required
          >
            <option />
            {
              Object.getOwnPropertyNames(queryTypes).map(function(name) {
                return <option key={name} value={queryTypes[name]}>{name}</option>
              })
            }
          </Field>
        </div>
        <div className="col-sm-6">
          <Field
            className="pt-input"
            type="search"
            placeholder="Query Term"
            // onChange={e => this.updateFilter(e.target.value.toLowerCase())}
            dir="auto"/>
        </div>
        <div className="col-sm-2">
          <Button className="pt-intent-primary pt-icon-remove"/>
        </div>
      </div>

    return (
      <div className="pt-card pt-dark pt-elevation-2">
        <div className="row">
          <div className="col-sm-4">
            Query
          </div>
          <div className="col-sm-6">
            Keyword
          </div>
          <div className="col-sm-2 text-right">
            <Button onClick={this.props.addQuery} className="pt-intent-primary pt-icon-add"/>
          </div>
        </div>

        {queries}

        <div className="row">
          <div className="col-sm-12">
            <table className="pt-table pt-interactive pt-condensed pt-striped"
                   style={{tableLayout: 'fixed', width: "100%"}}>
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
              {txRows.length === 0 ? <tr>
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

function mapStateToProps(state) {
  console.log(state);
  return {
    tx: state.transactions.tx,
    queryTypes: state.transactionTable.queryTypes
  };
}

export default withRouter(connect(mapStateToProps, {fetchTx, addQuery})(TransactionTable));
