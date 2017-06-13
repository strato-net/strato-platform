import React, {Component} from 'react';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import {Button, Collapse} from '@blueprintjs/core';
import * as moment from 'moment';
import { selectContractInstance, fetchState } from './contractCard.actions';
import './contractCard.css';
import mixpanel from 'mixpanel-browser';


class ContractCard extends Component {
  constructor(props) {
    super(props);
    this.state = {isOpen: false};
  }

  render() {
    let cardData = [];
    const name = this.props.contract.name;
    const contract = this.props.contract.contract;
    const instances = contract && contract.instances ? contract.instances : [];
    const self = this;
    const re = /[0-9a-fA-F]{40}$/;

    instances
      .filter((instance) => {return re.test(instance.address)})
      .forEach(function (instance) {
        cardData.push(
          <tr
            className={instance.selected ? 'selected' : ''}
            onClick={() => {
              mixpanel.track("contract_state_clicked")
              self.props.fetchState(name, instance.address);
              self.props.selectContractInstance(name, instance.address);
            }}
            key={'card-data-' + instance.address}
          >
            <td style={{border: 'none'}}>
              {instance.address}
            </td>
            <td style={{border: 'none'}}>
              {moment(instance.createdAt).format('YYYY-MM-DD hh:mm:ss A')}
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

    if(selectedInstance.length > 0 && selectedInstance[0].state) {
      const instance = selectedInstance[0];
      const symbolTable = [];
      const symbols = Object.getOwnPropertyNames(instance.state);
      if(symbols.length > 0) {
        symbolTable.push(
          <tr key={'header' + instance.address}>
            <th>Symbol</th>
            <th>State</th>
          </tr>
        );

        symbols.forEach((symbol, i) => {
          symbolTable.push(<tr key={symbol + ' ' + i}>
            <td>{symbol}</td>
            <td>{instance.state[symbol]}</td>
          </tr>)
        })
      }
      state = (
        <div className="pt-card pt-dark pt-elevation-2">
          <div className="row">
            <div className="col-sm-12">
              <table className="pt-table pt-condensed pt-striped">
                {symbolTable}
              </table>
            </div>
          </div>
        </div>
      );
    }


    return (
      <div className="row">
        <div className="col-sm-6">
          <div className="pt-card pt-dark pt-elevation-2">
            <div className="row">
              <div className="col-sm-6"><h4>{name}</h4></div>
              <div className="col-sm-6 text-right">
                <Button type="button"
                   className="pt-dark pt-icon-double-caret-vertical btn-sm"
                   onClick={() => {
                     mixpanel.track("contracts_toggle_collapse_click");
                     this.setState({
                       isOpen: !this.state.isOpen
                     })
                   }}
                >
                  {this.state.isOpen ? "Hide" : "Show"} Contracts
                </Button>
              </div>
            </div>
            <div className="row">
              <div className="col-sm-12">
                <Collapse isOpen={this.state.isOpen} component="table" className="col-sm-12" transitionDuration={100}>
                  <table className="pt-table pt-interactive pt-condensed pt-striped">
                    <thead>
                    <tr>
                      <th>Contract Address</th>
                      <th>Created At</th>
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

function mapStateToProps(state) {
  return {
  };
}

export default withRouter(
  connect(mapStateToProps, {selectContractInstance, fetchState})(ContractCard)
);
