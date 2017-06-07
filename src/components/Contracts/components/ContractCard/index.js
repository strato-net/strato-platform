import React, {Component} from 'react';
import {Button, Collapse} from '@blueprintjs/core';
import * as moment from 'moment';
import ContractState from '../ContractState';

class ContractCard extends Component {
  constructor(props) {
    super(props);
    this.state = {isOpen: false, selectedAddress: ''};
  }

  render() {
    let cardData = [];
    const contract = this.props.contract;
    const subcontracts = contract.contract.subcontracts === undefined ? [] : contract.contract.subcontracts;
    const self = this;
    const re = /[0-9a-fA-F]{40}$/;
    subcontracts
      .filter((contract) => {return re.test(contract.address)})
      .forEach(function (contract) {
        cardData.push(<tr onClick={() => {self.setState({selectedAddress:contract.address});}} key={contract.address}>
            <td>{contract.address}</td>
            <td>
              {moment(contract.createdAt).format('YYYY-MM-DD hh:mm:ss A')}
            </td>
          </tr>
        );
    });

    cardData = cardData.length === 0 ? [<tr key={1}>
      <td colSpan="2" className="text-center">No Instances</td>
    </tr>] : cardData;

    return (
      <div className="row">
        <div className="pt-card pt-dark pt-elevation-2 col-md-6">
          <div className="col-sm-6"><h4>{this.props.contract.name}</h4></div>
          <div className="col-sm-6 text-right">
            <Button type="button"
               className="pt-dark pt-icon-double-caret-vertical btn-sm"
               onClick={() => {
               this.setState({isOpen: !this.state.isOpen})
               }}
            >
              {this.state.isOpen ? "Hide" : "Show"} Contracts
            </Button>
          </div>
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

        <div className="col-md-6">
          <ContractState contractName={this.props.contract.name}
                         contractAddress={this.state.selectedAddress}/>
        </div>
      </div>
    );
  }
}

export default ContractCard;
