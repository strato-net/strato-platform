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
import { Button, NonIdealState, Switch } from '@blueprintjs/core';

class ContractQuery extends Component {
  constructor(props) {
    super(props);
    this.state = {
      field: 'Select field',
      operator: 'eq',
      value: '',
      orgName: '',
      appName: '',
      history: false,
      eventName: '',
      tableName: ''
    }

    this.handleFieldChange = this.handleFieldChange.bind(this);
    this.handleValueChange = this.handleValueChange.bind(this);
    this.handleOperatorChange = this.handleOperatorChange.bind(this);
    this.handleAddTag = this.handleAddTag.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleRemoveTag = this.handleRemoveTag.bind(this);
    this.handleOrgNameChange = this.handleOrgNameChange.bind(this);
    this.handleAppNameChange = this.handleAppNameChange.bind(this);
    this.toggleHistory = this.toggleHistory.bind(this);
    this.handleEventNameChange = this.handleEventNameChange.bind(this);
    this.buildTableName = this.buildTableName.bind(this);
    this.submitTableQuery = this.submitTableQuery.bind(this);
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
    this.props.queryCirrus(this.props.match.params.name, this.props.contractQuery.queryString);
    this.setState({tableName: this.props.match.params.name})
  }
  
  componentWillMount() {
    this.props.clearQueryString();
    // this.props.queryCirrusVars(this.props.match.params.name);
    this.setState({tableName: this.props.match.params.name})
  }

  componentWillReceiveProps(nextProps) {
    if(this.props.contractQuery.queryString !== nextProps.contractQuery.queryString) {
      this.props.queryCirrus(nextProps.match.params.name, nextProps.contractQuery.queryString);
    }
  }

  handleOrgNameChange(org) {
    this.setState({orgName: org})
  }

  handleAppNameChange(app) {
    this.setState({appName: app})
  }

  toggleHistory() {
    this.setState({history: !this.state.history})
  }

  handleEventNameChange(event) {
    this.setState({eventName: event})
  }
  
  buildTableName(contractName, orgName=undefined, appName=undefined, history=false, eventName=undefined) {
    let historyPrefix = ""
    let orgPrefix = ""
    let appPrefix = ""
    let eventSuffix = ""
    if (history) {
      historyPrefix = "history@"
    }
    if (orgName) {
      orgPrefix = orgName + '-'
    }
    if (appName) {
      appPrefix = appName + '-'
    }
    if (eventName) {
      eventSuffix = "." + eventName
    }
    return historyPrefix + orgPrefix + appPrefix + contractName + eventSuffix
  }

  submitTableQuery() {
    const finalTableName = this.buildTableName(this.props.match.params.name, this.state.orgName, this.state.appName, this.state.history, this.state.eventName)
    this.setState({tableName: finalTableName})
    this.props.queryCirrus(finalTableName, this.props.contractQuery.queryString)
  }

  
  render() {
    const self = this;
    const name = this.props.match.params.name;

    let selectFields = this.props.contractQuery && this.props.contractQuery.queryResults && 
      Object.keys(this.props.contractQuery.queryResults[0] || [])
      .map((propertyName) => {
        return (<option key={name + '-field-' + propertyName} value={propertyName}>{propertyName}</option>);
      });
    let columns = this.props.contractQuery && this.props.contractQuery.queryResults && 
      Object.keys(self.props.contractQuery.queryResults[0] || []).map((propertyName) => {
        if (propertyName == "chainId") {
          propertyName = "Shard ID"
        }
      return (
        <Column
          key={'column-'+propertyName}
          name={propertyName}
          renderCell={
            (row) => 
              <Cell truncated={true} tooltip={
                self.props.contractQuery.queryResults[row][propertyName]}>
                <TruncatedFormat>
                  {self.props.contractQuery.queryResults[row][propertyName]}
                </TruncatedFormat>
              </Cell>
          }
        />
    );
    })

    if(this.props.contractQuery.vars) {
      selectFields 
      
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
            <h3>{name} Table</h3>
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
          <div className='col-sm-2'>
              <h4>Table Specification</h4>
          </div>
          <div className='col-sm-8'>
            <div className="pt-control-group smd-full-width smd-vertical-center" >
              <label className='pt-label pt-inline' style={{marginRight: '15px'}}>
                Org Name:
                <input
                  type="text"
                  className="pt-input"
                  placeholder="Org Name"
                  value={this.state.orgName}
                  onChange={e => this.handleOrgNameChange(e.target.value)}
                  />
              </label>
              <label className='pt-label pt-inline' style={{marginRight: '15px'}}>
                App Name:
                <input
                  type="text"
                  className="pt-input"
                  placeholder="App Name"
                  value={this.state.appName}
                  onChange={e => this.handleAppNameChange(e.target.value)}
                  />
              </label>
              <label className='pt-label pt-inline' style={{marginRight: '15px'}}>
                Event Name:
                <input
                  type="text"
                  className="pt-input"
                  placeholder="Event Name"
                  value={this.state.eventName}
                  onChange={e => this.handleEventNameChange(e.target.value)}
                  />
              </label>
              <div>
                <Switch
                  checked={this.state.history}
                  onChange={this.toggleHistory}
                  label="Query Contract History"
                  />
              </div>
            </div>
          </div>
            <div className='col-sm-2'>
              <Button className='pt-intent-primary' onClick={this.submitTableQuery}>
                Go
              </Button>
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
                  <option value="address">Address</option>
                  <option value="chainId">Shard ID</option>
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
                  <option value="ilike">ILIKE</option>
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
              Query URL: { env.CIRRUS_URL + '/' + this.state.tableName + '?' + this.props.contractQuery.queryString }
            </code>
          </div>
        </div>

        <div className="row">
        </div>
        <div className="row">
        {
          this.props.contractQuery.queryResults &&
            this.props.contractQuery.queryResults.length > 0 ?
            <div className="col-sm-12">
              <Table 
                numRows={this.props.contractQuery.queryResults ?
                  this.props.contractQuery.queryResults.length : 0}
                className='pt-striped'
                  >
                {columns}
              </Table>
            </div> 
            : <NonIdealState 
              visual="pt-icon-folder-open" 
              title="No Results" 
              description={
                <div>
                  <p>
                    There was no data found in the selected table name. 
                  </p>
                  <hr/>
                  <p>
                    Try adding the Organization that created this Contract or the App Name that this Contract is a part of.
                  </p>  
                </div>
              } />
        }
        </div>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    contractQuery: state.contractQuery,
    selectedChain: state.chains.selectedChain,
    contractAddress: state.contractAddress
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
