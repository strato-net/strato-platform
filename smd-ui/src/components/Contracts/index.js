import React, { Component } from 'react';
import { fetchContracts, changeContractFilter } from './contracts.actions';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import CreateContract from '../CreateContract';
import ContractCard from './components/ContractCard';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import Tour from '../Tour';
import { Button } from '@blueprintjs/core';

const tourSteps = [
  /*  {
      title: 'Create Contract',
      text: 'Where queries are to be found.',
      selector: '#tour-create-contract-button',
      position: 'bottom', type: 'hover',
      isFixed: true,
    }, */
  {
    title: 'View Transactions',
    text: 'Scroll through all transactions launched from your Smart Contract.',
    selector: '#transactions',
    position: 'bottom',
    isFixed: true,
  },
];

class Contracts extends Component {
  constructor(props) {
    super(props);
    this.state = {
      limit: 10,
      offset: 0
    }
  }

  componentWillMount() {
    mixpanelWrapper.track("contracts_loaded");
    this.props.changeContractFilter('');
    this.props.fetchContracts(this.props.selectedChain, this.state.limit, this.state.offset);
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.selectedChain !== this.props.selectedChain)
      this.props.fetchContracts(nextProps.selectedChain, this.state.limit, this.state.offset);
  }

  updateFilter = (filter) => {
    this.props.changeContractFilter(filter);
  }

  onNextClick = () => {
    const { offset, limit } = this.state;
    const newOffset = offset + limit;
    this.setState({ offset: newOffset }, () => {
      this.props.fetchContracts(this.props.selectedChain, this.state.limit, this.state.offset);
    });
  };

  onPrevClick = () => {
    const { offset, limit } = this.state;
    const newOffset = Math.max(0, offset - limit);
    this.setState({ offset: newOffset }, () => {
      this.props.fetchContracts(this.props.selectedChain, this.state.limit, this.state.offset);
    });
  };

  render() {
    const contracts = this.props.contracts;
    const filter = this.props.filter;
    const contractNames = Object.getOwnPropertyNames(this.props.contracts);


    const cards = contractNames.length === 0 ? [] : contractNames
      .filter(function (contract) {
        if (!filter) {
          return true;
        }
        return contract.toLowerCase().indexOf(filter) > -1;
      })
      .map((value, i) => {
        return (
          <div className="row pt-dark" key={'contract-card-' + i}>
            <div className="col-sm-12">
              {value && <ContractCard contract={{ name: value, contract: contracts[value] }} />}
              <br />
            </div>
          </div>
        );
      });

    const isPaginationDisplay = cards.length ? true : Boolean(this.state.offset);

    return (
      <div className="container-fluid">
        <Tour steps={tourSteps} name="contracts" finalStepSelector='#transactions' nextPage='transactions' />
        <div className="row pt-dark">
          <div className="col-sm-3 text-left">
            <h3>Contracts</h3>
          </div>
          <div className="col-sm-5 smd-pad-16">
            <div className="pt-input-group pt-dark pt-large">
              <span className="pt-icon pt-icon-search"></span>
              <input
                className="pt-input"
                type="search"
                placeholder="Search contracts"
                onChange={e => this.updateFilter(e.target.value.toLowerCase())}
                dir="auto" />
            </div>
          </div>
          <div className="col-sm-4 text-right smd-pad-8">
            <CreateContract />
          </div>
        </div>

        {!cards.length && !this.props.isLoading &&
          <div className="row pt-dark" key={'contract-card-'}>
            <div className="col-sm-12">
              <h4>No Contracts</h4>
              <h5>Upload a Contract to View State</h5>
              <br />
            </div>
          </div>}
        {this.props.isLoading ?
          <div className="row pt-dark">
            <div className="col-sm-12">
              <div className="row">
                <div className="col-sm-6">
                  <div className="pt-card pt-elevation-2">
                    <div className="row">
                      <div className="col-sm-4"><h4>Working...</h4></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          : cards
        }
        {isPaginationDisplay && <div className="pt-dark">
          <div className="row">
            <div className="col-sm-2 smd-pad-16 text-left">
              <Button
                onClick={this.onPrevClick}
                className="pt-icon-arrow-left"
                text="Previous"
                disabled={!(this.state.offset > 0)}
              />
            </div>
            <div className="col-sm-2 text-center" style={{ marginTop: '22px' }}>
              {`Rows ${this.state.offset + 1}-${this.state.offset + Math.min(cards.length, this.state.limit)}`}
            </div>
            <div className="col-sm-2 smd-pad-16 text-right">
              <Button
                onClick={this.onNextClick}
                className="pt-icon-arrow-right"
                text="Next"
                disabled={cards.length < this.state.limit}
              />
            </div>
          </div>
        </div>}
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    contracts: state.contracts.contracts,
    filter: state.contracts.filter,
    selectedChain: state.chains.selectedChain,
    isLoading: state.contracts.isLoading
  };
}

export default withRouter(connect(mapStateToProps, { fetchContracts, changeContractFilter })(Contracts));
