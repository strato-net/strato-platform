import React, {Component} from 'react';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import {fetchState} from './contractState.actions';

class ContractState extends Component {

  componentWillReceiveProps() {
    if (this.props.contractAddress) this.props.fetchState(this.props.contractName, this.props.contractAddress);
  }

  render() {
    const state = this.props.states[this.props.contractAddress] === undefined ? {} : this.props.states[this.props.contractAddress];
    const symbols = Object.getOwnPropertyNames(state);

    const symbolTable = [];
    if(symbols.length > 0) {
      symbolTable.push(
        <tr key={'header' + this.props.contractAddress}>
          <th>Symbol</th>
          <th>State</th>
        </tr>
      );

      symbols.forEach((symbol, i) => {
        symbolTable.push(<tr key={symbol + ' ' + i}>
          <td>{symbol}</td>
          <td>{state[symbol]}</td>
        </tr>)
      })
    }

    if(symbols.length > 0) {
      return (
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
    else {
      return null;
    }
  }
}

function mapStateToProps(state) {
  return {
    states: state.contractState.states,
    clicked: state.contracts.clicked,
  };
}

export default withRouter(connect(mapStateToProps, {fetchState})(ContractState));
