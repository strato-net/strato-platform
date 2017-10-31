import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import {Text} from '@blueprintjs/core';
class PeersCard extends Component {
  
  renderPeers(peers) {
    return <div className="row pt-text-muted">
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
      (peers) => this.renderPeers(peers)
    )
    const clientPeers = node.peers && node.peers.clientPeers && node.peers.clientPeers.map(
      (peers) => this.renderPeers(peers)
    )
    let className = 'pt-card pt-elevation-2';
    return (
      <div className={className}>
        {node.peers && node.peers.clientPeers.length>0 && <h5>ClientPeer</h5>}
       {clientPeers}
       <hr/>
       {node.peers && node.peers.serverPeers.length>0 && <h5>ServerPeer</h5>}        
       {serverPeers}
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
