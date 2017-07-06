import React, { Component } from 'react';
import {withRouter} from 'react-router-dom';
import {connect} from 'react-redux';
import {Table, Column, Cell} from '@blueprintjs/table';

class ContractQuery extends Component {
  render() {
    const name = this.props.match.params.name;
    const renderCell = (rowIndex: number) => <Cell>{`$${(rowIndex * 10).toFixed(2)}`}</Cell>;

    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-12">
            <h3>Query {name}</h3>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-6 smd-pad-8">
            <div className="pt-control-group">
              <div className="pt-select">
                <select className="pt-select">
                  <option selected>Select field</option>
                </select>
              </div>
              <div className="pt-select">
                <select>
                  <option value="eq" selected>=</option>
                  <option value="neq">!=</option>
                  <option value="lt">&lt;</option>
                  <option value="lte">&lt;=</option>
                  <option value="gt">&gt;</option>
                  <option value="gte">&gt;=</option>
                  <option value="in">IN</option>
                  <option value="like">LIKE</option>
                </select>
              </div>
              <div className="pt-input-group">
                <input
                  type="text"
                  className="pt-input"
                  placeholder="Enter query value"
                  style={{
                    width: '400px'
                  }} />
                <button className="pt-button pt-minimal pt-icon-arrow-right">
                  Add Filter
                </button>
              </div>
            </div>
          </div>
          <div className="col-sm-6 smd-pad-8">
          
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12 smd-pad-8">
            <code>
              http://localhost/cirrus/search/ProjectManager
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
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {}
  )(ContractQuery)
);
