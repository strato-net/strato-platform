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
    if (chain && chain.info && chain.info.balances && chain.info.balances.length > 0) {
      const balances = chain.info.balances;

      return balances.filter((balance) => {
        return balance.address !== '0000000000000000000000000000000000000100'
      })
        .map((balance, index) => {
          return (
            <tr key={index}>
              <td>{balance.address}</td>
              <td>{balance.balance}</td>
            </tr>
          )
        })
    } else {
      return (
        <tr>
          <td colSpan="2"> No Memberzzz</td>
        </tr>
      )
    }
  };

  showMembers2(chain) {
    // this.forceUpdate();
    if (chain){
      if(chain.info){
        if(chain.info.members){
      const members = chain.info.members;


        members.map((member) => {
          return (
            <tr >
              <td>{member.orgName}</td>
              <td>{member.orgUnit}</td>
              <td>{member.commonName}</td>
            </tr>
          )
        })
        }
        else{
          return(<tr>
          <td colSpan="2"> No chain info members whatsoever</td>
        </tr>)
        }
      }
      else{
        return(<tr>
        <td colSpan="2"> No chain info whatsoever</td>
      </tr>)
      }
    }else{
      return (<tr>
      <td colSpan="2"> No chain whatsoever</td>
    </tr>)
    }
    // if (chain) {
    //   const members = chain.info.members;


    //     members.map((member) => {
    //       return (
    //         <tr >
    //           <td>{member.orgName}</td>
    //           <td>{member.orgUnit}</td>
    //           <td>{member.commonName}</td>
    //         </tr>
    //       )
    //     })
    // } else {
    //   return (
    //     <tr>
    //       <td colSpan="2"> No Memberzzz2</td>
    //     </tr>
    //   )
    // }
  };

  render() {
    const {
      label,
      id,
      chain
    } = this.props;

    console.log(`========= chain? ${JSON.stringify(chain)}`)

    return (
      <div className="pt-card address-margin-bottom" key={label}>
        <div className="row smd-pad-2 smd-margin-4 smd-vertical-center">
          <div className="col-sm-10">
            <h5>
              Chain Id: &nbsp;&nbsp; <HexText value={id} classes="smd-pad-2" />
            </h5>
            <h4>{chain}</h4>
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
            {this.showMembers(chain)}
          </tbody>
        </table>

        <table className="pt-table pt-str chain-detail">
          <thead>
            <tr>
              <th>Org Name</th>
              <th>Org Unit</th>
              <th>Common Name</th>
            </tr>
          </thead>
          <tbody>
            {this.showMembers2(chain)}
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
    {
      fetchChainDetail
    }
  )(Chain)
);
