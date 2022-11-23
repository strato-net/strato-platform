import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import HexText from '../HexText';
import './chain.css';
import { fetchChainDetail } from '../Chains/chains.actions';

class Chain extends Component {


  componentWillReceiveProps(nextProps) {
    if (!Object.getOwnPropertyNames(nextProps.chain).length) {
      nextProps.fetchChainDetail(nextProps.label, nextProps.id);
    }
  }

  showMembers(chain) {
    if (chain && chain.info && chain.info.members && chain.info.members.length > 0) { 
      const members = chain.info.members;
      return members.map((member) => {
          return (
            <tr>
              <td>{member.orgName}</td>
              <td>{member.orgUnit}</td>
              <td>{member.commonName}</td>
              <td>{member.access.toString()}</td>
            </tr>
          )
        })
    } else {
      return (
        <tr>
          <td colSpan="2"> No members</td>
        </tr>
      )
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

        <div key ={chain}>
        <table className="pt-table pt-str chain-detail" >
          <thead>
            <tr>
              <th>Org Name</th>
              <th>Org Unit</th>
              <th>Common Name</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
             {this.showMembers(chain)}
          </tbody>
        </table></div>
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
    {
      fetchChainDetail
    }
  )(Chain)
);
