import React, {Component} from 'react';
import {fetchContracts} from './contracts.actions';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import CreateContract from '../CreateContract';
import * as moment from 'moment';

class Contracts extends Component {

  componentDidMount() {
    this.props.fetchContracts();
  }

  render() {
    const contracts = this.props.contracts;
    const rows = []
    Object.getOwnPropertyNames(this.props.contracts).forEach(function (contractName, i) {
      Object.values(contracts[contractName]).forEach(function (contract, j) {
        rows.push(
          <tr key={Math.random()}>
            <td className="col-sm-4">{contractName}</td>
            <td className="col-sm-4">{contract.address}</td>
            <td className="col-sm-4">
              {moment(contract.createdAt).format('YYYY-MM-DD hh:mm:ss A')}
            </td>
          </tr>
        )
      });
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

        <div className="row ">
          <div className="col-lg-6">
            <div className="pt-card pt-dark pt-elevation-2">
              <table className="pt-table pt-interactive pt-condensed pt-striped" style={{tableLayout: 'fixed'}}>
                <thead>
                <th className="col-sm-4"><h4>Contract Name</h4></th>
                <th className="col-sm-4"><h4>Contract Address</h4></th>
                <th className="col-sm-4"><h4>Created At</h4></th>
                </thead>

                <tbody>
                {rows}
                </tbody>
              </table>
            </div>
          </div>
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
