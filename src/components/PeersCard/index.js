import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Text } from '@blueprintjs/core';
import './peersCard.css';
class PeersCard extends Component {
  
  renderPeers(peers, index) {
    return <div key={index} className="row node-peers">
      <div className="col-xs-3">
        <small>IP: </small>
      </div>
      <div className="col-xs-9">
        <Text ellipsize={true}>
          <small>{peers.rpcPeerIP}</small>
        </Text>
      </div>
      <div className="col-xs-3">
        <small>Port: </small>
      </div>
      <div className="col-xs-9">
        <Text ellipsize={true}>
          <small>{peers.rpcPeerPort}</small>
        </Text>
      </div>
    </div>
  }

  render() {
    const node = this.props.nodes[this.props.nodeIndex];
    const serverPeers = node.peers && node.peers.serverPeers && node.peers.serverPeers.map(
      (peers, index) => this.renderPeers(peers, index)
    )
    const clientPeers = node.peers && node.peers.clientPeers && node.peers.clientPeers.map(
      (peers, index) => this.renderPeers(peers, index)
    )
    let className = 'pt-card pt-elevation-2';
    return (
      <div className={className}>
        <h5>Client Peer {`(${node.peers && node.peers.clientPeers.length})`}</h5>
        {node.peers && node.peers.clientPeers.length > 0 ? clientPeers :
          <Text ellipsize={true}>
            <small>No client peers</small>
          </Text>}
        <hr />
        <h5>Server Peer {`(${node.peers && node.peers.serverPeers.length})`}</h5>
        {node.peers && node.peers.serverPeers.length > 0 ? serverPeers :
          <Text ellipsize={true}>
            <small>No server peers</small>
          </Text>}
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    nodes: state.nodes.nodes
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    null
  )(PeersCard)
);
