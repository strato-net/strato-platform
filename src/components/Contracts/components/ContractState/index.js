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
    const variableData = []
    Object.getOwnPropertyNames(state).forEach((variable, i) => {
      variableData.push(<tr key={variable + ' ' + i}>
        <td>{variable}</td>
        <td>{state[variable]}</td>
      </tr>);
    })
    
    return (
    <div className="pt-card pt-dark pt-elevation-2">
      <div className="row">
        <div className="col-sm-12"><h4>State</h4></div>
      </div>
      <div className="row">
        <div className="col-sm-12">
          <table className="pt-table pt-condensed pt-striped">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>{variableData}</tbody>
          </table>
        </div>
      </div>
    </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    states: state.contractState.states,
    clicked: state.contracts.clicked,
  };
}

export default withRouter(connect(mapStateToProps, {fetchState})(ContractState));