import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { env } from '../../env';
import { Collapse } from '@blueprintjs/core';
import {
  fetchNodeDetail,
  fetchNodePeers,
  fetchNodeCoinbase
} from './nodeCard.actions';
import './nodeCard.css';
import PeersCard from '../PeersCard';
import HexText from '../HexText';

class NodeCard extends Component {

  constructor() {
    super()
    this.state = {
      isOpen: false
    }
  }

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
    }, env.POLLING_FREQUENCY);
  }

  handleClick = () => {
    this.setState({ isOpen: !this.state.isOpen });
  };

  render() {
    const node = this.props.nodes[this.props.nodeIndex];
    const peers = node.peers ? Object.getOwnPropertyNames(node.peers):[];
    const blockNumber = this.props.blockData.length > 0 ?
      this.props.blockData[0].blockData.number.toString()
      : 'unknown';
    let className = 'pt-card pt-elevation-2 ';
    className += node.apiFailure ? 'node-warning pt-interactive' : 'node-success pt-interactive';
    let arrowIcon = 'col-xs-3 text-right pt-icon-standard '
    arrowIcon += this.state.isOpen ? 'pt-icon-caret-up' : 'pt-icon-caret-down'

    return (
      <div>
        <div className={className} onClick={this.handleClick}>
          <div className="row">
            <div className="col-xs-9">
              <h5>{node.name}</h5>
            </div>
            <span className={arrowIcon}></span>
          </div>
          <div className="row pt-text-muted">
            <div className="col-xs-3">
              <small>Coinbase</small>
            </div>
            <div className="col-xs-9">
              <small> <HexText value={node.coinbase} classes="smd-pad-2"/> </small>
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
              <small>{peers.length}</small>
            </div>
          </div>
        </div>
        <Collapse isOpen={this.state.isOpen}>
          <PeersCard nodeIndex={this.props.nodeIndex} />
        </Collapse>
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