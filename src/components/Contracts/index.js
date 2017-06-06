import React, {Component} from 'react';
import {fetchContracts, changeContractFilter} from './contracts.actions';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import CreateContract from '../CreateContract';
import ContractCard from './components/ContractCard';
import * as moment from 'moment';

class Contracts extends Component {

  componentDidMount() {
    this.props.fetchContracts();
  }

  updateFilter = (filter) => {
    this.props.changeContractFilter(filter);
  }

  render() {
    const contracts = this.props.contracts;
    const filter = this.props.filter;
    const contractNames = Object.getOwnPropertyNames(this.props.contracts);
    const contractRows = [];

    contractNames
      .filter(function(contract){
                if(!filter) {
                    return true;
                  }
               return contract.toLowerCase().indexOf(filter) > -1; })
      .forEach(function (contractName, i) {
      contractRows.push({name: contractName, rows: []});
      let subcontracts = contracts[contractName].subcontracts === undefined ? {} : contracts[contractName].subcontracts;
      Object.values(subcontracts).forEach(function (contract, j) {
        contractRows[i].rows.push(<tr key={Math.random()}>
          <td className="col-md">{contract.address}</td>
          <td className="col-md">
            {moment(contract.createdAt).format('YYYY-MM-DD hh:mm:ss A')}
          </td>
        </tr>);
      });
    });

    const cards = contractRows.map((value) => {
      return (
            <ContractCard value={value} contract={contracts[value.name]}/>
        );
    });

    return (
      <div>
        <div className="row pt-dark">
          <div className="col-md-3 text-left">
            <h3>Contracts</h3>
          </div>
          <div className="col-md-6 smd-pad-16">
            <div className="pt-input-group pt-dark pt-large">
              <span className="pt-icon pt-icon-search"></span>
              <input
                className="pt-input"
                type="search"
                placeholder="Search input"
                onChange={e => this.updateFilter(e.target.value.toLowerCase())}
                dir="auto"/>
            </div>
          </div>
          <div className="col-md-3 text-right">
            <CreateContract/>
          </div>
        </div>
        {cards}
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    contracts: state.contracts.contracts,
    filter: state.contracts.filter
  };
}

export default withRouter(connect(mapStateToProps, {fetchContracts, changeContractFilter})(Contracts));
