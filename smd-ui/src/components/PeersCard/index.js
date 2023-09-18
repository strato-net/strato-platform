import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Text } from '@blueprintjs/core';
import './peersCard.css';
import HexText from '../HexText';
import { getPeerIdentityRequest } from './peers.actions';
class PeersCard extends Component {

  extractPubkey(enode) {
    return enode.substring(8, 128 + 8)
  }

  render() {
    const node = this.props.node;
    const peers = node.peers ? Object.getOwnPropertyNames(node.peers) : [];
    let className = 'pt-card pt-elevation-2';
    return (
      <div className={className}>
        {peers.length > 0
          ? peers.map((peer, index) => {
            return (
              <div key={index} className="row node-peers">
                <div className="col-xs-3">
                  <small>Public Key:
                  </small>
                </div>
                <div className="col-xs-9">
                  <small>
                    <HexText value={this.extractPubkey(node.peers[peer].enode)}/>
                  </small>
                </div>
                <div className="col-xs-3">
                  <small>IP:
                  </small>
                </div>
                <div className="col-xs-9">
                  <Text ellipsize={true}>
                    <small>{peer}</small>
                  </Text>
                </div>
                <div className="col-xs-3">
                  <small>Port:
                  </small>
                </div>
                <div className="col-xs-9">
                  <Text ellipsize={true}>
                    <small>{node.peers[peer].tcp_port}</small>
                  </Text>
                </div>
              </div>
            )
          })
          : <Text ellipsize={true}>
            <small>No peers</small>
          </Text>}
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return { 
    node: state.node,
    peerIds: state.peers,
  };
}

export default withRouter(connect(mapStateToProps, {
  getPeerIdentityRequest
})(PeersCard));
