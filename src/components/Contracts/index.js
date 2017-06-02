import React, {Component} from 'react';
import {fetchContracts} from './contracts.actions';
import {connect} from 'react-redux';
import {Button} from '@blueprintjs/core';
import {withRouter} from 'react-router-dom';
import CreateContract from '../CreateContract';
import * as moment from 'moment';

class Contracts extends Component {

  componentDidMount() {
    this.props.fetchContracts();
  }

  queryCard() {

  }

  render() {
    const contracts = this.props.contracts;
    const contractRows = [];
    Object.getOwnPropertyNames(this.props.contracts).forEach(function (contractName, i) {
      contractRows.push({name: contractName, rows: []});
      Object.values(contracts[contractName]).forEach(function (contract, j) {
        contractRows[i].rows.push(<tr key={Math.random()}>
          <td className="col-sm-3">{contract.address}</td>
          <td className="col-sm-3">
            {moment(contract.createdAt).format('YYYY-MM-DD hh:mm:ss A')}
          </td>
          <td className="col-sm-2">
            <Button type="button" onClick={this.queryCard} className="pt-intent-primary">Query Contract</Button>
          </td>
        </tr>);
      });
    });

    const cards = contractRows.map((value) => {
      return (
        <div className="row smd-pad-16">
          <div className="col-lg-6">
            <div className="pt-card pt-dark pt-elevation-2">
              <h3>{value.name}</h3>
              <table className="pt-table pt-interactive pt-condensed pt-striped" style={{tableLayout: 'fixed'}}>
                <thead>
                <th className="col-sm-2"><h4>Contract Address</h4></th>
                <th className="col-sm-2"><h4>Created At</h4></th>
                <th className="col-sm-2"><h4>Cirrus</h4></th>
                </thead>

                <tbody>
                {value.rows}
                </tbody>
              </table>
            </div>
          </div>
        </div>);
    });

    return (
      <div>
        <div className="row pt-dark">
          <div className="col-sm-3 text-left">
            <h3>Contracts</h3>
          </div>
          <div className="col-sm-6 smd-pad-16">
            <div className="pt-input-group pt-dark pt-large">
              <span className="pt-icon pt-icon-search"></span>
              <input className="pt-input" type="search" placeholder="Search input" dir="auto"/>
            </div>
          </div>
          <div className="col-sm-3 text-right">
            <CreateContract/>
          </div>
        </div>

        <div className="row">
          {cards}
          <div className="col-lg-6">
            <div className="pt-card pt-dark pt-elevation-2">

            </div>
          </div>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    contracts: state.contracts.contracts
  };
}

export default withRouter(connect(mapStateToProps, {fetchContracts})(Contracts));
