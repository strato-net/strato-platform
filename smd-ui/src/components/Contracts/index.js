import React, { Component } from 'react';
import { fetchContracts, changeContractFilter } from './contracts.actions';
import { connect } from 'react-redux';
import CreateContract from '../CreateContract';
import ContractCard from './components/ContractCard';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import Tour from '../Tour';
import { Button, Popover, PopoverInteractionKind, Position, Switch, Tooltip} from '@blueprintjs/core';
import ReactGA from 'react-ga4';
import { Field, reduxForm } from 'redux-form';
import { selectChain, fetchChainIds, fetchChainDetailSelect } from '../Chains/chains.actions';
import { withRouter } from 'react-router-dom';
import HexText from '../HexText';

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
      offset: 0,
      chainLimit: 25,
      chainOffset: 0,
      useSearch: true,
      chainSearchQueryField: "chainid",
      chainQuery: "",
    }
  }

  componentWillMount() {
    mixpanelWrapper.track("contracts_loaded");
    this.props.changeContractFilter('');
    this.props.fetchContracts(this.props.selectedChain, this.state.limit, this.state.offset);
    this.props.fetchChainIds(this.chainLimit, this.chainOffset);
  }

  componentDidMount() {
    ReactGA.send({hitType: "pageview", page: "/contracts", title: "Contracts"});
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.selectedChain !== this.props.selectedChain) {
      this.props.fetchContracts(nextProps.selectedChain, this.state.limit, this.state.offset);

    }
  }

  updateFilter = (filter) => {
    this.props.changeContractFilter(filter);
  }

  onChainSearch = () => {
    this.props.fetchChainDetailSelect(this.state.chainQuery, this.state.chainSearchQueryField)
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

  onNextChainClick = () => {
    const { chainOffset, chainLimit } = this.state;
    const newOffset = chainOffset + chainLimit;
    this.setState({ chainOffset: newOffset }, () => {
      this.props.fetchChainIds(this.state.chainLimit, this.state.chainOffset);
    });
  };

  onPrevChainClick = () => {
    const { chainOffset, chainLimit } = this.state;
    const newOffset = Math.max(0, chainOffset - chainLimit);
    this.setState({ chainOffset: newOffset }, () => {
      this.props.fetchChainIds(this.state.chainLimit, this.state.chainOffset);
    });
  };

  toggleChainQueryType = (e) => {
    this.setState({ useSearch : !this.state.useSearch }, () => {
      if (!this.state.useSearch) {
        this.setState({chainQuery : ""})
        this.props.fetchChainIds(this.chainLimit, this.chainOffset);
      }

    })
  }

  render() {
    const contracts = this.props.contracts;
    const filter = this.props.filter;
    const contractNames = Object.getOwnPropertyNames(this.props.contracts);

    const returnedInstances = contracts && contractNames.length > 0 ? Object.values(contracts).reduce((prev, cur) => {
      return prev + cur.instances.length
    }, 0) : 0

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
    const chainSelector = this.state.useSearch ? (
      <div className="row smd-margin-16" style={{ display: 'flex', alignItems: 'center', marginRight: '8px'}}>
        <h4 className="text-left" style={{margin: '0 8px 0 0'}}>Shard {this.state.chainSearchQueryField == "chainid" ? "ID" : "Label"}:</h4>
        <input 
          className='pt-input smd-pad-4 pt-icon-search' 
          type="search" 
          name="chainQuery" 
          placeholder={this.state.chainSearchQueryField == "chainid" ? "Shard ID" : "Shard Label"}
          onChange={(e) => {
            this.setState({chainQuery: e.target.value})
          }}
          value={this.state.chainQuery}
        />
        <div className="pt-select" style={{margin: '0 5px'}}>
          <Field
            className="pt-input"
            component="select"
            name="searchByChainId"
            defaultValue={"chainid"}
            onChange={
              (e) => {
                this.setState({chainSearchQueryField: e.target.value});
              }
            }
            required
            >
            <option key={"chainid"} value={"chainid"}>Shard ID</option>
            {/* get chains api does not accept this query param :( <option key={"label"} value={"label"}>Shard Label</option> */}
          </Field>
        </div>
        <div>
          <button className="pt-button" onClick={(e) => this.onChainSearch(this.state.chainQuery)}>Select Shard</button>
        </div>
      </div>) : 
      
          <div className='row smd-margin-16' style={{ display: 'flex', alignItems: 'center', marginRight: '8'}}>
              <h4 className="text-left" style={{margin: '0 auto'}}>Shard:</h4>
              <div className="pt-select" style={{margin: '0 5px'}}>
                <Field
                  className="pt-input select-chain"
                  component="select"
                  name="chainLabel"
                  onChange={
                    (e) => {
                      const data = e.target.value === 'Main Chain' ? null : e.target.value;
                      this.props.selectChain(data);
                    }
                  }
                  required
                  >
                  <option>Main Chain </option>
                  {
                    this.props.chainIds.map((label, i) => {
                      return (
                        <option key={label.id} value={label.id}>{label.label}</option>
                        )
                      })
                    }
                </Field>
              </div>
            <div className="smd-pad-2 text-left">
              <Button
                onClick={this.onPrevChainClick}
                className="pt-icon-arrow-left"
                text="Previous"
                disabled={!(this.state.chainOffset > 0)}
                />
            </div>
            <div className="smd-pad-2 text-right">
              <Button
                onClick={this.onNextChainClick}
                className="pt-icon-arrow-right"
                text="Next"
                disabled={this.props.chainIds.length < this.state.chainLimit}
                />
            </div>

          </div>
    return (
      <div className="container-fluid">
        <Tour steps={tourSteps} name="contracts" finalStepSelector='#transactions' nextPage='transactions' />
        <div className="row pt-dark" >
          <div className="col-sm-2 text-left">
            <h3>Contracts</h3>
          </div>
        <div className="col-sm-6 smd-pad-16">
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
    
        </div>
        <div className='row pt-dark' style={{ display: 'flex', alignItems: 'center'}}>
            <div className=" chain-wrapper text-right smd-pad-8 col-sm-12" style={{paddingLeft: '50px'}}>
              {this.props.chainIds && this.props.chainIds ?
                    <div className='row'  style={{ display: 'flex', alignItems: 'center'}}>
                      {chainSelector}
                      <div className="smd-pad-8 col-sm-4" style={{display: 'flex', alignItems: 'center'}}>
                        <Switch
                          checked={this.state.useSearch}
                          onChange={this.toggleChainQueryType}
                          label="Search by Shard ID"
                        />
                        </div>
                      <div className='col-sm-4 text-left'>
                        <strong>Shard ID:</strong> { this.props.selectedChain ? <HexText value={this.props.selectedChain}></HexText> : 'Main Chain'}
                      </div>
                    </div>
              : ''}
            </div>
            <div className="col-sm-2 text-right smd-pad-8">
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
              {`Rows ${this.state.offset + 1}-${this.state.offset + Math.min(cards.length, this.state.limit)} (${returnedInstances} Contract Instances)`}
            </div>
            <div className="col-sm-2 smd-pad-16 text-right">
              <Button
                onClick={this.onNextClick}
                className="pt-icon-arrow-right"
                text="Next"
                disabled={returnedInstances < this.state.limit}
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
    isLoading: state.contracts.isLoading,
    chainIds: state.chains.chainIds,
  };
}

const formed = reduxForm({ form: 'Contracts' })(Contracts);
const connected = connect(mapStateToProps, {
  selectChain,
  fetchChainIds,
  fetchChainDetailSelect,
  fetchContracts, 
  changeContractFilter
})(formed);

export default withRouter(connected);
