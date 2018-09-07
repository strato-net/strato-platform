import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Collapse } from '@blueprintjs/core';
import {
  selectContractInstance,
  fetchState,
  fetchCirrusInstances,
  fetchAccount
} from './contractCard.actions';
import ContractMethodCall from '../ContractMethodCall';
import './contractCard.css';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { Link } from 'react-router-dom';
import HexText from '../../../HexText';
import { Tooltip, Position } from '@blueprintjs/core';

class ContractCard extends Component {
  constructor(props) {
    super(props);
    this.state = { isOpen: false };
  }

  componentWillMount() {
    this.props.fetchCirrusInstances(this.props.contract.name);
  }

  render() {
    let cardData = [];
    const name = this.props.contract.name;
    const contract = this.props.contract.contract;
    const instances = contract && contract.instances ? contract.instances : [];
    const self = this;
    const re = /[0-9a-fA-F]{40}$/;
    const showQueryBuilder = instances.reduce((acc, instance) => {
      return acc || instance.fromCirrus;
    }, false);

    instances
      .filter((instance) => { return re.test(instance.address) })
      .forEach(function (instance) {
        cardData.push(
          <tr
            className={instance.selected ? 'selected' : ''}
            onClick={() => {
              mixpanelWrapper.track("contract_state_clicked")
              self.props.fetchState(name, instance.address, self.props.selectedChain);
              self.props.fetchAccount(name, instance.address);
              self.props.selectContractInstance(name, instance.address);
            }}
            key={'card-data-' + instance.address}
          >
            <td style={{ border: 'none' }}>
              <HexText value={instance.address} classes="small smd-pad-4" />
            </td>
            <td style={{ border: 'none' }}>
              {instance.fromBloc ?
                <span className="pt-tag pt-intent-success smd-margin-right-4">Bloc</span> : ''
              }
              {instance.fromCirrus ?
                <span className="pt-tag pt-intent-primary">Cirrus</span> : ''
              }
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
      const symbolTable = [];
      const symbols = Object.getOwnPropertyNames(instance.state);
      if (symbols.length > 0) {
        symbols.forEach((symbol, i) => {
          const symbolState = instance.state[symbol];
          symbolTable.push(
            <tr key={symbol + ' ' + i}>
              <td
                style={{
                  verticalAlign: 'middle',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '90px'
                }}>
                <Tooltip
                  content={symbol}
                  position={Position.TOP_LEFT}>
                  {symbol}
                </Tooltip>
              </td>
              <td style={{ maxWidth: '300px' }}>
                <pre>
                  {
                    typeof symbolState === 'string' ?
                      symbolState
                      : JSON.stringify(symbolState, null, 2)
                  }
                </pre>
              </td>
              <td style={{ verticalAlign: 'middle' }}>
                {
                  typeof symbolState === 'string' && symbolState.startsWith('function') ?
                    <ContractMethodCall
                      key={'methodCall' + symbol + instance.address}
                      lookup={'methodCall' + symbol + instance.address}
                      contractName={name}
                      contractAddress={instance.address}
                      symbolName={symbol}
                      fromCirrus={instance.fromCirrus}
                      fromBloc={instance.fromBloc}
                    />
                    : null
                }
              </td>
            </tr>
          );
        })

      }
      state = (
        <div className="pt-card pt-elevation-2">
          <div className="row">
            <div className="col-sm-12 text-right">
              <span className="pt-monospace-text"> {instance && instance.balance ? <div> Balance: {instance.balance} wei </div> : ''} </span>
            </div>
          </div>
          <div className="row">
            <div className="col-sm-12">
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
                  {
                    showQueryBuilder ?
                      <Link to={'/contracts/' + name + '/query'}>
                        <Button type="Button" className="pt-intent-primary">
                          Query Builder
                        </Button>
                      </Link>
                      : null
                  }
                  <Button type="button"
                    className="pt-icon-double-caret-vertical btn-sm"
                    onClick={() => {
                      mixpanelWrapper.track("contracts_toggle_collapse_click");
                      this.setState({
                        isOpen: !this.state.isOpen
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
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>{cardData}</tbody>
                  </table>
                </Collapse>
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

export function mapStateToProps(state) {
  return {
    selectedChain: state.chains.selectedChain
  };
}

export default withRouter(
  connect(mapStateToProps, {
    selectContractInstance,
    fetchState,
    fetchCirrusInstances,
    fetchAccount
  })(ContractCard)
);
