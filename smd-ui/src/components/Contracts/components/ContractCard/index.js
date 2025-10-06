import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Collapse } from '@blueprintjs/core';
import {
  selectContractInstance,
  fetchState,
  fetchCirrusInstances,
  fetchAccount,
  fetchContractInfoRequest
} from './contractCard.actions';
import { fetchContracts } from '../contracts.actions';
import ContractMethodCall from '../ContractMethodCall';
import './contractCard.css';
// import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
// import { Link } from 'react-router-dom';
import HexText from '../../../HexText';
import { Tooltip, Position } from '@blueprintjs/core';
import ContractSource from './ContractSource';

class ContractCard extends Component {
  constructor(props) {
    super(props);
    // If search term exists and matches an instance, start open
    const hasSearchMatch = this.props.contract.searchTerm && 
      this.props.contract.contract && this.props.contract.contract.instances &&
      this.props.contract.contract.instances.some(instance => 
        instance.address.toLowerCase() === this.props.contract.searchTerm.toLowerCase()
      );
    this.state = { 
      isOpen: hasSearchMatch,
      instanceOffset: 0,
      instanceLimit: 10
    };
  }

  componentWillMount(){
    const name = this.props.contract.name;
    const searchTerm = this.props.contract.searchTerm;
    if(searchTerm){
      this.props.fetchState(name, searchTerm, this.props.selectedChain);
      this.props.fetchAccount(name, searchTerm);
      this.props.fetchContractInfoRequest(`card-data-${searchTerm}-${this.props.selectedChain}`, name, searchTerm)
      this.props.selectContractInstance(name, searchTerm);
    }
  }

  onNextInstanceClick = () => {
    const newOffset = this.state.instanceOffset + this.state.instanceLimit;
    this.setState({ instanceOffset: newOffset }, () => {
      this.fetchContractInstances();
    });
  };

  onPrevInstanceClick = () => {
    const newOffset = Math.max(0, this.state.instanceOffset - this.state.instanceLimit);
    this.setState({ instanceOffset: newOffset }, () => {
      this.fetchContractInstances();
    });
  };

  fetchContractInstances = () => {
    const { instanceOffset, instanceLimit } = this.state;
    this.props.fetchContracts(
      this.props.selectedChain,
      10, // contract limit
      0,  // contract offset
      this.props.contract.name, // contract name filter
      instanceOffset,
      instanceLimit
    );
  };

  render() {
    let cardData = [];
    const name = this.props.contract.name;
    const contract = this.props.contract.contract;
    const instances = contract && contract.instances ? contract.instances : [];
    const searchTerm = this.props.contract.searchTerm;
    const self = this;
    const re = /[0-9a-fA-F]{40}$/;
    const showQueryBuilder = instances.reduce((acc, instance) => {
      return acc || instance.fromCirrus;
    }, false);

    // Filter instances based on search term if present
    const filteredInstances = searchTerm ? 
      instances.filter(instance => 
        re.test(instance.address) && 
        instance.address.toLowerCase() === searchTerm.toLowerCase()
      ) :
      instances.filter(instance => re.test(instance.address));

    // Calculate total instances for pagination display
    const { instanceOffset, instanceLimit } = this.state;
    const totalInstances = filteredInstances.length;
    const hasMoreInstances = totalInstances >= instanceLimit && (instanceOffset + instanceLimit) < totalInstances;

    filteredInstances
      .forEach(function (instance, index) {
        cardData.push(
          <tr
            className={instance.selected ? 'selected' : ''}
            onClick={() => {
              // mixpanelWrapper.track("contract_state_clicked")
              self.props.fetchState(name, instance.address, self.props.selectedChain);
              self.props.fetchAccount(name, instance.address);
              self.props.fetchContractInfoRequest(`card-data-${instance.address}-${self.props.selectedChain}`, name, instance.address, self.props.selectedChain)
              self.props.selectContractInstance(name, instance.address);
            }}
            key={`card-data-${instance.address}-${index}`}
          >
            <td style={{ border: 'none' }}>
              <HexText value={instance.address} classes="small smd-pad-4" />
            </td>
          </tr>
        );
      });

    cardData = cardData.length === 0 ? [<tr key={1}>
      <td colSpan={2} className="text-center">No Instances</td>
    </tr>] : cardData;


    const selectedInstance = instances.filter(
      (instance) => { return instance.selected }
    );
    let state = null;

    if (selectedInstance.length > 0 && selectedInstance[0].state) {
      const instance = selectedInstance[0];
      const contractKey = `card-data-${instance.address}-${self.props.selectedChain}`
      const contractInfo = this.props.contractInfos && this.props.contractInfos[contractKey] ? this.props.contractInfos[contractKey] : {}
      const symbolTable = [];
      const symbols = Object.getOwnPropertyNames(instance.state);
      if ((typeof instance.state !== 'string') && symbols.length > 0) {
        symbols.forEach((symbol, i) => {
          if (symbol === 'constructor') {
            return
          }
          const symbolState = instance.state[symbol];
          symbolTable.push(
            <tr key={symbol + ' ' + i}>
              {
                typeof symbolState === 'string' && symbolState.startsWith('function') ?
                <td style={{ verticalAlign: 'middle' }}>
                  <ContractMethodCall
                    key={'methodCall' + symbol + instance.address}
                    contractKey={contractKey}
                    methodKey={'methodCall' + symbol + instance.address}
                    contractName={name}
                    contractAddress={instance.address}
                    symbolName={symbol}
                    fromCirrus={instance.fromCirrus}
                    fromBloc={instance.fromBloc}
                    chainId={self.props.selectedChain}
                  />
                </td>
                :
              <td
                style={{
                  verticalAlign: 'middle',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '120px'
                }}>
                <Tooltip
                  content={symbol}
                  position={Position.TOP_LEFT}>
                  {symbol}
                </Tooltip>
              </td>
              }
              <td style={{ maxWidth: '500px' }}>
                <pre>
                  {
                    typeof symbolState === 'string' ?
                      symbolState
                      : JSON.stringify(symbolState, null, 2)
                  }
                </pre>
              </td>
              
            </tr>
          );
        })

      }
      state = (
        <div className="pt-card pt-elevation-2">

            <div className="row">
            <div className='col-sm-6'>
              { contractInfo &&
                <ContractSource
                  contract={contractInfo}
                  />
              }
            </div>
            <div className="col-sm-6 text-right">
              <span className="pt-monospace-text"> {instance && instance.balance ? <div> Contract Balance: {instance.balance} wei </div> : ''} </span>
            </div>
          </div>
          <div className="row">
            <div className="col-sm-12">
              {typeof instance.state !== 'string' ?  
                <table className="pt-table pt-condensed pt-striped smd-full-width">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th className="text-right">State</th>
                      <th style={{ width: '105px' }} className="text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {symbolTable}
                  </tbody>
                </table>
              : <div className='warning'> 
                  <h4>Error</h4>
                  <div>
                    {instance.state}
                  </div>
                </div> 
                }
            </div>
          </div>
        </div>
      );
    }
    
    return (
      <div className="row">
        <div className="col-sm-6">
          <div className="pt-card pt-elevation-2">
            <div className="row">
              <div className="col-sm-4"><h4>{name}</h4></div>
              <div className="col-sm-8 text-right">
                <div className="pt-button-group">
                    <Button 
                      type="Button" 
                      className="pt-intent-primary pt-icon-th" 
                      onClick={() => {
                        this.props.history.push('/contracts/' + name + '/query')
                      }}
                    >
                      Tabular Data
                    </Button>
                  <Button type="button"
                    className="pt-icon-double-caret-vertical btn-sm"
                    onClick={() => {
                      // mixpanelWrapper.track("contracts_toggle_collapse_click");
                      if(this.state.isOpen) {
                        this.props.selectContractInstance(name, null);
                      }
                      this.setState({
                        isOpen: !this.state.isOpen,
                        instanceOffset: 0  // Reset instance pagination when toggling
                      })
                    }}
                  >
                    {this.state.isOpen ? "Hide" : "Show"} Contracts
                  </Button>

                </div>

              </div>
            </div>
            <div className="row">
              <div className="col-sm-12">
                <Collapse isOpen={this.state.isOpen} component="table" className="col-sm-12" transitionDuration={100}>
                  <table className="pt-table pt-interactive pt-condensed pt-striped smd-full-width">
                    <thead>
                      <tr>
                        <th>Contract Address</th>
                      </tr>
                    </thead>
                    <tbody>{cardData}</tbody>
                  </table>
                </Collapse>
                {/* Instance Pagination Controls */}
                {this.state.isOpen && (instanceOffset > 0 || hasMoreInstances) && (
                  <div className="col-sm-12 pt-dark mt-2">
                    <div className="row">
                      <div className="col-sm-3 text-left">
                        <Button
                          onClick={this.onPrevInstanceClick}
                          className="pt-icon-arrow-left"
                          text="Previous"
                          disabled={!(instanceOffset > 0)}
                        />
                      </div>
                      <div className="col-sm-6 text-center" style={{ marginTop: '22px' }}>
                        {`Instances ${instanceOffset + 1}-${Math.min(instanceOffset + instanceLimit, totalInstances)} (${totalInstances} Total)`}
                      </div>
                      <div className="col-sm-3 text-right">
                        <Button
                          onClick={this.onNextInstanceClick}
                          className="pt-icon-arrow-right"
                          text="Next"
                          disabled={!hasMoreInstances}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-6">
          {state}
        </div>
      </div>
    );
  }
}

export function mapStateToProps(state, ownProps) {
  return {
    contractInfos: state.contractCard.contractInfos,
    selectedChain: state.chains.selectedChain
  };
}

export default withRouter(
  connect(mapStateToProps, {
    selectContractInstance,
    fetchContractInfoRequest,
    fetchState,
    fetchCirrusInstances,
    fetchAccount,
    fetchContracts
  })(ContractCard)
);
