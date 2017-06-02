import React, {Component} from 'react';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import TransactionList from "../TransactionList";
import { fetchBlockData } from '../BlockData/block-data.actions';
import BarGraph from '../BarGraph';
import PieChart from '../PieChart';
import {Text} from '@blueprintjs/core';
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
            <div className="pt-card pt-elevation-2 node-success">
              <h5>Node 0</h5>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Coinbase</small>
                </div>
                <div className="col-xs-9">
                  <Text ellipsize={true}>
                    <small> e062bc64387256babbe59456b8daadeb32eae5a4</small>
                  </Text>
                </div>
              </div>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Block</small>
                </div>
                <div className="col-xs-9">
                  <small>17</small>
                </div>
              </div>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Peers</small>
                </div>
                <div className="col-xs-9">
                  <small>2</small>
                </div>
              </div>
            </div>
            <div className="pt-card pt-elevation-2 node-warning">
              <h5>Node 1</h5>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Coinbase</small>
                </div>
                <div className="col-xs-9">
                  <Text ellipsize={true}>
                    <small> e062bc64387256babbe59456b8daadeb32eae5a4</small>
                  </Text>
                </div>
              </div>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Block</small>
                </div>
                <div className="col-xs-9">
                  <small>17</small>
                </div>
              </div>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Peers</small>
                </div>
                <div className="col-xs-9">
                  <small>2</small>
                </div>
              </div>
            </div>
            <div className="pt-card pt-elevation-2 node-success">
              <h5>Node 2</h5>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Coinbase</small>
                </div>
                <div className="col-xs-9">
                  <Text ellipsize={true}>
                    <small> e062bc64387256babbe59456b8daadeb32eae5a4</small>
                  </Text>
                </div>
              </div>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Block</small>
                </div>
                <div className="col-xs-9">
                  <small>17</small>
                </div>
              </div>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Peers</small>
                </div>
                <div className="col-xs-9">
                  <small>2</small>
                </div>
              </div>
            </div>
            <div className="pt-card pt-elevation-2 node-danger">
              <h5>Node 3</h5>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Coinbase</small>
                </div>
                <div className="col-xs-9">
                  <Text ellipsize={true}>
                    <small> e062bc64387256babbe59456b8daadeb32eae5a4</small>
                  </Text>
                </div>
              </div>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Block</small>
                </div>
                <div className="col-xs-9">
                  <small>17</small>
                </div>
              </div>
              <div className="row pt-text-muted">
                <div className="col-xs-3">
                  <small>Peers</small>
                </div>
                <div className="col-xs-9">
                  <small>2</small>
                </div>
              </div>
            </div>
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
  };
}

export default withRouter(connect(mapStateToProps, {fetchBlockData})(Dashboard))
