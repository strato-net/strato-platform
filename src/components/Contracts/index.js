import React, {Component} from 'react';
import {fetchContracts, changeContractFilter} from './contracts.actions';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import CreateContract from '../CreateContract';
import ContractCard from './components/ContractCard';

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

    const cards = contractNames
      .filter(function(contract){
                if(!filter) {
                    return true;
                  }
               return contract.toLowerCase().indexOf(filter) > -1; })
      .map((value) => {
        return (
          <div className="row pt-dark">
            <div className="col-sm-12">
              <ContractCard contract={{name: value, contract: contracts[value]}} key={'ContractCard'+contracts[value].address}/>
            </div>
          </div>
        );
      });

    return (
      <div className="container-fluid">
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
