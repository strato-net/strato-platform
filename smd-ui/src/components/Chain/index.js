import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import HexText from '../HexText';

class Chain extends Component {

  showMembers(chain) {
    if (chain && chain.balances && chain.balances.length > 0) {
      const balances = chain.balances;
      const ret = [];
      balances.forEach(function (balance, index) {
        if (balance.address && balance.address !== '0000000000000000000000000000000000000100') {
          ret.push(
            <tr key={index}>
              <td>{balance.address}</td>
              <td>{balance.balance}</td>
            </tr>
          );
        }
      });
      return ret;
    }
    else {
      return (<div> No Members </div>);
    }
  };

  render() {
    const {
      label,
      id,
      chain
    } = this.props;

    return (
      <div className="pt-card address-margin-bottom" key={label}>
        <div className="row smd-pad-2 smd-margin-4 smd-vertical-center">
          <div className="col-sm-10">
            <h5>
              Chain Id: &nbsp;&nbsp; <HexText value={id} classes="smd-pad-2" />
            </h5>
          </div>
        </div>

        <table className="pt-table pt-str chain-detail">
          <thead>
            <tr>
              <th>Member Address</th>
              <th>Member Balance</th>
            </tr>
          </thead>
          <tbody>
            {chain[0] && this.showMembers(chain[0]["info"])}
          </tbody>
        </table>
      </div>
    );
  }
}

export function mapStateToProps(state, ownProps) {
  const label = ownProps.label;
  const id = ownProps.id;
  const chains = state.chains.chains;
  return {
    chain: Object.getOwnPropertyNames(chains).indexOf(label) >= 0 ? chains[label][id] : {},
  };
}

export default withRouter(
  connect(
    mapStateToProps,
  )(Chain)
);
