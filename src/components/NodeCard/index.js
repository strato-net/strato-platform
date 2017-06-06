import React, {Component} from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import {Text} from '@blueprintjs/core';
import {
  fetchNodeDetail,
  fetchNodePeers,
  fetchNodeCoinbase
} from './nodeCard.actions';

class NodeCard extends Component {

  componentDidMount() {
    //this.props.fetchNodeDetail(this.props.nodeIndex);
    this.props.fetchNodePeers(this.props.nodeIndex);
    this.props.fetchNodeCoinbase(this.props.nodeIndex);
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
  }

  startPoll() {
    const fetchNodePeers = this.props.fetchNodePeers;
    const nodeIndex = this.props.nodeIndex;

    this.timeout = setInterval(function () {
      fetchNodePeers(nodeIndex);
    }, 5000);
  }

  render() {
    const node = this.props.nodes[this.props.nodeIndex];
    const peers = node.peers && node.peers.serverPeers && node.peers.clientPeers ?
      (node.peers.serverPeers.length + node.peers.clientPeers.length).toString()
      : 'unknown';

    const blockNumber = this.props.blockData.length > 0 ?
      this.props.blockData[0].blockData.number.toString()
      : 'unknown';

    return (
      <div className="pt-card pt-elevation-2 node-success">
        <h5>{node.name}</h5>
        <div className="row pt-text-muted">
          <div className="col-xs-3">
            <small>Coinbase</small>
          </div>
          <div className="col-xs-9">
            <Text ellipsize={true}>
              <small>{node.coinbase}</small>
            </Text>
          </div>
        </div>
        <div className="row pt-text-muted">
          <div className="col-xs-3">
            <small>Block</small>
          </div>
          <div className="col-xs-9">
            <small>{blockNumber}</small>
          </div>
        </div>
        <div className="row pt-text-muted">
          <div className="col-xs-3">
            <small>Peers</small>
          </div>
          <div className="col-xs-9">
            <small>{peers}</small>
          </div>
        </div>
      </div>
    );
  }

}

function mapStateToProps(state) {
  return {
    blockData: state.blockData.blockData,
    nodes: state.nodes.nodes
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {
      fetchNodeDetail,
      fetchNodePeers,
      fetchNodeCoinbase
    }
  )(NodeCard)
);
