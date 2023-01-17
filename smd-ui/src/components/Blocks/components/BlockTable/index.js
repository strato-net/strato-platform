import React, { Component } from 'react';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { Field, reduxForm, reset, Form } from 'redux-form';
import { BLOCK_QUERY_TYPES, RESOURCE_TYPES } from '../../../QueryEngine/queryTypes';
import { fetchBlockData } from '../../../BlockData/block-data.actions';
import { updateQuery, clearQuery, executeQuery, removeQuery } from '../../../QueryEngine/queryEngine.actions';
import { withRouter } from 'react-router-dom';
import { Text, Button } from '@blueprintjs/core';
import moment from 'moment';
import HexText from '../../../HexText';

class BlockTable extends Component {

  componentDidMount() {
    this.props.fetchBlockData(this.props.selectedChain);
    this.props.executeQuery(RESOURCE_TYPES.block, this.props.query, this.props.selectedChain);
  }

  componentWillUnmount() {
    this.props.clearQuery();
  }

  componentWillReceiveProps(newProps) {
    if (newProps.query !== this.props.query)
      newProps.executeQuery(RESOURCE_TYPES.block, newProps.query, newProps.selectedChain);
    if (newProps.selectedChain !== this.props.selectedChain)
      this.props.fetchBlockData(newProps.selectedChain);
  }

  // dispatchSubmit = () => {
  //   this.props.dispatch(submit('block-query'));
  // }

  submit = (values) => {
    this.props.updateQuery(values.query, values.value);
    this.props.dispatch(reset('block-query'));
  };

  refresh = () => {
    this.props.clearQuery();
    this.props.executeQuery(RESOURCE_TYPES.block, this.props.query, this.props.selectedChain);
  };

  render() {
    const history = this.props.history;
    const { handleSubmit } = this.props;

    function handleClick(blockNumber) {
      mixpanelWrapper.track("blocks_row_click");
      history.push('/blocks/' + blockNumber);
    }

    let blockRows = this.props.queryResult.length && this.props.queryResult[0]['kind'] && this.props.queryResult.map(
      function (block) {
        return (
          <tr key={block.blockData.number} onClick={() => {
            handleClick(block.blockData.number)
          }}>
            <td width="10%">
              <small>{block.blockData.number}</small>
            </td>
            <td width="22.5%">
              <HexText value={block.blockData.parentHash} classes="small smd-pad-4" />
            </td>
            <td width="15%">
              <Text ellipsize={true}>
                <small>
                  {block.blockData.difficulty}
                </small>
              </Text>
            </td>
            <td width="10%">
              <Text ellipsize={true}>
                <small>
                  {block.blockData.nonce}
                </small>
              </Text>
            </td>
            <td width="20%">
              <Text ellipsize={true}>
                <small>
                  {moment(block.blockData.timestamp).format('YYYY-MM-DD hh:mm:ss A')}
                </small>
              </Text>
            </td>
          </tr>
        )
      }
    );

    const required = value => value ? undefined : 'Required'
    const queryTypes = BLOCK_QUERY_TYPES;
    const queryForm =
      <div className="row smd-pad-4">
        <div className="col-sm-12">
          <Form onSubmit={handleSubmit(this.submit)}>
            <div className="pt-control-group smd-full-width">
              <div className="pt-select">
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
                        mixpanelWrapper.track('blocks_query_submit');
                      }
                    }
                  }
                  dir="auto" />
              </div>
              <Button type="submit" onClick={() => {
                // this.dispatchSubmit();
                mixpanelWrapper.track('blocks_query_submit');
              }}
                className="pt-intent-primary pt-icon-arrow-right" />
            </div>
          </Form>
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
            mixpanelWrapper.track('blocks_query_remove_tag');
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
              style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead>
                <tr>
                  <th width="10%"><h5>Block Number</h5></th>
                  <th width="45%"><h5>Parent Hash</h5></th>
                  <th width="15%"><h5>Difficulty</h5></th>
                  <th width="10%"><h5>Nonce</h5></th>
                  <th width="20%"><h5>Timestamp</h5></th>
                </tr>
              </thead>

              <tbody>
                {!blockRows ? <tr>
                  <td colSpan={6}>No Blocks</td>
                </tr> : blockRows}
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
    queryResult: state.queryEngine.queryResult,
    selectedChain: state.chains.selectedChain
  };
}
const formed = reduxForm({ form: 'block-query' })(BlockTable);
const connected = connect(mapStateToProps, {
  fetchBlockData,
  updateQuery,
  removeQuery,
  executeQuery,
  clearQuery
})(formed);
export default withRouter(connected);
