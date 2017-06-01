import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import Transactions from "../Transactions";
import { fetchBlockData } from '../BlockData/block-data.actions';
import NumberCard from '../NumberCard';
import BarGraph from '../BarGraph';
import PieChart from '../PieChart';
import { Text } from '@blueprintjs/core';
import './dashboard.css';

class Dashboard extends Component {

  componentDidMount() { //FIXME Put fetchDifficulty on a timer?
    this.props.fetchBlockData();
  }

  render() {
    const difficultyData = [{ x: 1, y: 134392 }, { x: 2, y: 126456 }, { x: 3, y: 131392 },
            { x: 4, y: 131348 }, { x: 5, y: 132264 }, { x: 6, y: 111200 },
            { x: 7, y: 141200 }, { x: 8, y: 151136 }, { x: 9, y: 91072 },
            { x: 10, y: 130000 }, { x: 11, y: 135264 }, { x: 12, y: 131272 },
            { x: 13, y: 100000 }, { x: 14, y: 121136 }, { x: 15, y: 141072 }];
    const txCountData = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 },
            { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 3 },
            { x: 7, y: 2 }, { x: 8, y: 2 }, { x: 9, y: 1 },
            { x: 10, y: 1 }, { x: 11, y: 4 }, { x: 12, y: 2 },
            { x: 13, y: 3 }, { x: 14, y: 1 }, { x: 15, y: 2 }];
    const blockPropData = [{ x: 1, y: 119650345 }, { x: 2, y: 145 }, { x: 3, y: 145 },
            { x: 4, y: 14945 }, { x: 5, y: 14960345 }, { x: 6, y: 140345 },
            { x: 7, y: 1490345 }, { x: 8, y: 1490345 }, { x: 9, y: 14965035 },
            { x: 10, y: 1496345 }, { x: 11, y: 14950345 }, { x: 12, y: 14965230345 },
            { x: 13, y: 1496545 }, { x: 14, y: 149650345 }, { x: 15, y: 1496345 }];

    return (
      <div className="container pt-dark">
        <div className="row">
          <div className="col-sm-9 text-left">
            <h2>Dashboard</h2>
          </div>
          <div className="col-sm-3 text-right">
            <p className="network-status">NETWORK IN SYNC</p>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">
            <BarGraph data={difficultyData} label={"Difficulty"} identifier={"Difficulty"} />
          </div>
          <div className="col-sm-3">
            <BarGraph data={txCountData} label={"Transaction Count"} identifier={"TxCount"}/>
          </div>
          <div className="col-sm-3">
            <BarGraph data={blockPropData} label={"Block Propagation"} identifier={"BlockProp"}/>
          </div>
          <div className="col-sm-3">
            <PieChart />
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
                  <Text ellipsize={true}><small> e062bc64387256babbe59456b8daadeb32eae5a4</small></Text>
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
                  <Text ellipsize={true}><small> e062bc64387256babbe59456b8daadeb32eae5a4</small></Text>
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
                  <Text ellipsize={true}><small> e062bc64387256babbe59456b8daadeb32eae5a4</small></Text>
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
                  <Text ellipsize={true}><small> e062bc64387256babbe59456b8daadeb32eae5a4</small></Text>
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
            <Transactions />
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

export default withRouter(connect(mapStateToProps, { fetchBlockData })(Dashboard))
