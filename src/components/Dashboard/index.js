import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import NodeCard from '../NodeCard';
import TransactionList from "../TransactionList";
import { fetchBlockData } from '../BlockData/block-data.actions';
import BarGraph from '../BarGraph';
import PieChart from '../PieChart';
import './dashboard.css';

class Dashboard extends Component {

  componentDidMount() {
    this.props.fetchBlockData();
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
  }

  startPoll() {
    const dashboardFetchStatus = this.props.fetchBlockData;
    this.timeout = setInterval(function () {
      dashboardFetchStatus();
    }, 5000);
  }

  difficulty(blockData) {
    return Object.values(blockData).map(function (val, i) {
      return {x: i, y: val.difficulty};
    })
  }

  blockPropogation(blockData) {
    let timeData = [];
    let times = Object.values(blockData).map(function (val) {
      return val.timestamp
    });

    var i= 0;
    for (; i < times.length-1; i++) {
      let obj = {x: i, y: Math.abs((new Date(times[i+1]).getSeconds()) - (new Date(times[i]).getSeconds()))};
      timeData.push(obj);
    }
    return timeData;
  }


  txCount(blockData) {
    return blockData.map(val => {
      return val.length
    }).reduce((x, y) => {
      return x + y
    }, 0);
  }

  txFreq(blockData) {
    return blockData.map(function (val, i) {
      return {x: i, y: val.length};
    })
  }

  txType(blockData) {
    let types = {"FunctionCall" : 0, "Transfer": 0, "Contract": 0};
    blockData.forEach(function (val) {
      val.forEach(v => { types[v.transactionType]++ });
    })
    return [ {val: types["FunctionCall"]}, {val: types["Transfer"]}, {val: types["Contract"]} ];
  }

  render() {
    const blockData = Object.values(this.props.blockData).map(val => {
      return val.blockData
    });

    const receiptTransactions = Object.values(this.props.blockData).map(val => {
      return val.receiptTransactions
    });

    const difficultyData = this.difficulty(blockData);
    const txFreqData = this.txFreq(receiptTransactions);
    const txCount = this.txCount(receiptTransactions);
    const blockPropData = this.blockPropogation(blockData);
    const txTypeData = this.txType(receiptTransactions);

    const nodes = this.props.nodes.map((node, i) => <NodeCard nodeIndex={i} key={'node-card' + i} />);

    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-9 text-left">
            <h3>Dashboard</h3>
          </div>
          <div className="col-sm-3 text-right">
            <p className="network-status">NETWORK IN SYNC</p>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">
            <BarGraph data={difficultyData} label={"Difficulty"} identifier={"Difficulty"}/>
          </div>
          <div className="col-sm-3">
            <BarGraph data={txFreqData} number={txCount} label={"Transaction Count"} identifier={"TxCount"}/>
          </div>
          <div className="col-sm-3">
            <BarGraph data={blockPropData} units="s" label={"Block Propagation"} identifier={"BlockProp"}/>
          </div>
          <div className="col-sm-3">
            <PieChart data={txTypeData}/>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <br/>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">
            <h4>Nodes</h4>
            {nodes}
          </div>
          <div className="col-sm-9">
            <h4>Recent Transactions</h4>
            <TransactionList />
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

export default withRouter(connect(mapStateToProps, {fetchBlockData})(Dashboard))
