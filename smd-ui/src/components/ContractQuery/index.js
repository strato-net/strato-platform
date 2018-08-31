import React, { Component } from 'react';
import {withRouter} from 'react-router-dom';
import {connect} from 'react-redux';
import {Table, Column, Cell, JSONFormat, TruncatedFormat} from '@blueprintjs/table';
import {
  clearQueryString,
  queryCirrusVars,
  addQueryFilter,
  removeQueryFilter,
  queryCirrus
} from './contractQuery.actions.js';
import { env } from '../../env.js';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { Button } from '@blueprintjs/core';

class ContractQuery extends Component {
  constructor(props) {
    super(props);
    this.state = {
      field: 'Select field',
      operator: 'eq',
      value: ''
    }

    this.handleFieldChange = this.handleFieldChange.bind(this);
    this.handleValueChange = this.handleValueChange.bind(this);
    this.handleOperatorChange = this.handleOperatorChange.bind(this);
    this.handleAddTag = this.handleAddTag.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleRemoveTag = this.handleRemoveTag.bind(this);
  }

  handleKeyUp(event) {
    if(event.key === 'Enter' && this.state.value !== '' && this.state.field !== 'Select field') {
      this.handleAddTag();
    }
  }

  handleFieldChange(event) {
    mixpanelWrapper.track('contract_query_field_change');
    this.setState({
      ...this.state,
      field: event.target.value
    });
  }

  handleOperatorChange(event) {
    mixpanelWrapper.track('contract_query_operator_change');
    this.setState({
      ...this.state,
      operator: event.target.value
    });
  }

  handleValueChange(event) {
    this.setState({
      ...this.state,
      value: event.target.value
    });
  }

  handleAddTag() {
    mixpanelWrapper.track('contract_query_add_tag_click');
    this.props.addQueryFilter(this.state.field, this.state.operator, this.state.value);
    this.setState({
      field: 'Select field',
      operator: 'eq',
      value: ''
    });
  }

  handleRemoveTag(i) {
    mixpanelWrapper.track('contract_query_remove_tag_click');
    this.props.removeQueryFilter(i);
  }

  componentDidMount() {
    mixpanelWrapper.track('contract_query_load');
    this.props.queryCirrus(this.props.match.params.name, this.props.contractQuery.queryString, this.props.selectedChain);
  }

  componentWillMount() {
    this.props.clearQueryString();
    this.props.queryCirrusVars(this.props.match.params.name);
  }

  componentWillReceiveProps(nextProps) {
    if(this.props.contractQuery.queryString !== nextProps.contractQuery.queryString) {
      this.props.queryCirrus(nextProps.match.params.name, nextProps.contractQuery.queryString, nextProps.selectedChain);
    }
    if(this.props.selectedChain !== nextProps.selectedChain) {
      this.props.queryCirrus(nextProps.match.params.name, nextProps.contractQuery.queryString, nextProps.selectedChain);
    }
  }

  render() {
    const self = this;
    const name = this.props.match.params.name;

    let selectFields = null;
    let columns = [
      <Column
        key="column-address"
        name="address"
        renderCell={
          (row) => 
            <Cell>
              <TruncatedFormat>
                {self.props.contractQuery.queryResults[row].address}
              </TruncatedFormat>
            </Cell>
        }
      />
    ];

    if(this.props.contractQuery.vars) {
      selectFields = Object
        .getOwnPropertyNames(this.props.contractQuery.vars)
        .filter((propertyName) => {
          return this.props.contractQuery.vars[propertyName].type !== 'Mapping'
            && this.props.contractQuery.vars[propertyName].type !== 'Array';
        })
        .map((propertyName) => {
          return (<option key={name + '-field-' + propertyName} value={propertyName}>{propertyName}</option>);
        });
      columns = columns.concat(
        Object
          .getOwnPropertyNames(this.props.contractQuery.vars)
          .filter((propertyName) => {
            return this.props.contractQuery.vars[propertyName].type !== 'Mapping'
          })
          .map((propertyName) => {
            return (
              <Column
                key={'column-'+propertyName}
                name={propertyName}
                renderCell={
                  (row) => 
                    <Cell>
                      {
                        self.props.contractQuery.vars[propertyName].type === 'Mapping' ||
                        self.props.contractQuery.vars[propertyName].type === 'Array' ||
                        self.props.contractQuery.vars[propertyName].type === 'Struct' ?
                          <JSONFormat>
                            {self.props.contractQuery.queryResults[row][propertyName]}
                          </JSONFormat>
                          :
                          <TruncatedFormat>
                            {self.props.contractQuery.queryResults[row][propertyName]}
                          </TruncatedFormat>
                      }
                    </Cell>
                }
              />
          );
          })
        );
    }

    const tags = this.props.contractQuery.tags.map((tag, i) => {
      return (
        <span key={'tag-' + tag.field + '-' + i } className="pt-tag pt-tag-removable smd-margin-right">
          {tag.field + ' ' + tag.operator + ' ' + tag.value}
          <button className="pt-tag-remove" onClick={ (e) => { self.handleRemoveTag(i); } } />
        </span>
      )
    })

    const addFilterEnabled = this.state.value !== '' && this.state.field !== 'Select field';

    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-6">
            <h3>Query {name}</h3>
          </div>
          <div className="col-sm-6 smd-pad-16 text-right">
            <Button
              onClick={
                (e) => {
                  mixpanelWrapper.track('contract_query_go_back_click');
                  this.props.history.goBack();
                }
              }
              className="pt-icon-arrow-left"
              text="Back"
            />
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12 smd-pad-8">
            <div className="pt-control-group smd-full-width">
              <div className="pt-select">
                <select
                  className="pt-select"
                  value={this.state.field}
                  onChange={this.handleFieldChange}
                >
                  <option>Select field</option>
                  <option value="address">address</option>
                  {selectFields}
                </select>
              </div>
              <div className="pt-select">
                <select
                  value={this.state.operator}
                  onChange={this.handleOperatorChange}
                >
                  <option value="eq">=</option>
                  <option value="neq">!=</option>
                  <option value="lt">&lt;</option>
                  <option value="lte">&lt;=</option>
                  <option value="gt">&gt;</option>
                  <option value="gte">&gt;=</option>
                  <option value="in">IN</option>
                  <option value="like">LIKE</option>
                </select>
              </div>
              <input
                type="text"
                className="pt-input"
                placeholder="Enter query value"
                value={this.state.value}
                onChange={this.handleValueChange}
                onKeyUp={this.handleKeyUp}
                style={
                  {
                    width: '80%'
                  }
                }
              />
              <button
                className="pt-button pt-intent-primary pt-icon-arrow-right"
                onClick={this.handleAddTag}
                disabled={!addFilterEnabled}
              >
              </button>
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            {tags}
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12 smd-pad-8">
            <code>
              Query URL: { env.CIRRUS_URL + '/' + name + '?' + this.props.contractQuery.queryString + '&chainId=' + this.props.selectedChain }
            </code>
          </div>
        </div>

        <div className="row">
        </div>
        <div className="row">
          <div className="col-sm-12">
            <Table numRows={this.props.contractQuery.queryResults ?
                this.props.contractQuery.queryResults.length : 0}>
              {columns}
            </Table>
          </div>
        </div>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    contractQuery: state.contractQuery,
    selectedChain: state.chains.selectedChain
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {
      clearQueryString,
      queryCirrusVars,
      addQueryFilter,
      removeQueryFilter,
      queryCirrus
    }
  )(ContractQuery)
);
