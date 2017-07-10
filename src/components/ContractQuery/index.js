import React, { Component } from 'react';
import {withRouter} from 'react-router-dom';
import {connect} from 'react-redux';
import {Table, Column, Cell} from '@blueprintjs/table';
import {
  clearQueryString,
  queryCirrusVars,
  addQueryFilter
} from './contractQuery.actions.js';
import { env } from '../../env.js';

// TODO: handle enter key
// TODO: remove tags
// TODO: render query results on screen

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
  }

  handleKeyUp(event) {
    if(event.key == 'Enter') {
      this.handleAddTag();
    }
  }

  handleFieldChange(event) {
    this.setState({
      ...this.state,
      field: event.target.value
    });
  }

  handleOperatorChange(event) {
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
    this.props.addQueryFilter(this.state.field, this.state.operator, this.state.value);
    this.setState({
      field: 'Select field',
      operator: 'eq',
      value: ''
    });
  }

  componentWillMount() {
    this.props.clearQueryString();
    this.props.queryCirrusVars(this.props.match.params.name);
  }

  render() {
    const name = this.props.match.params.name;
    const renderCell = (rowIndex: number) => <Cell>{`$${(rowIndex * 10).toFixed(2)}`}</Cell>;

    const selectFields = this.props.contractQuery.vars ?
      Object
        .getOwnPropertyNames(this.props.contractQuery.vars)
        .filter((propertyName) => {
          return this.props.contractQuery.vars[propertyName].type !== 'Mapping'
            && this.props.contractQuery.vars[propertyName].type !== 'Array';
        })
        .map((propertyName) => {
          return (<option key={name + '-field-' + propertyName} value={propertyName}>{propertyName}</option>);
        })
      : null;

    const tags = this.props.contractQuery.tags.map((tag, i) => {
      return (
        <span key={'tag-' + tag.field + '-' + i } className="pt-tag pt-tag-removable smd-margin-right">
          {tag.field + ' ' + tag.operator + ' ' + tag.value}
          <button className="pt-tag-remove" />
        </span>
      )
    })

    const addFilterEnabled = this.state.value !== '' && this.state.field !== 'Select field';

    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-12">
            <h3>Query {name}</h3>
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
              Query URL: { env.CIRRUS_URL + '/' + name + '?' + this.props.contractQuery.queryString }
            </code>
          </div>
        </div>

        <div className="row">
        </div>
        <div className="row">
          <div className="col-sm-12">
            <Table numRows={10}>
              <Column name="Dollars" renderCell={renderCell}/>
            </Table>
          </div>
        </div>
      </div>
    )
  }
}

function mapStateToProps(state, ownProps) {
  return {
    contractQuery: state.contractQuery
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {
      clearQueryString,
      queryCirrusVars,
      addQueryFilter
    }
  )(ContractQuery)
);
