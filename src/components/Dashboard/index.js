import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';
import NodeCard from '../NodeCard';
import TransactionList from '../TransactionList';
import NumberCard from '../NumberCard';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { fetchBlockData } from '../BlockData/block-data.actions';
import { fetchAccounts } from '../Accounts/accounts.actions';
import { endTour } from '../Tour/tour.actions';
// import { callAfterTour } from '../Tour/tour.helpers';

// import Tour from '../Tour';

import { env } from '../../env';
import BarGraph from '../BarGraph';
import PieChart from '../PieChart';

import './dashboard.css';
import { hideLoading } from 'react-redux-loading-bar';
import { subscribeRoom, unSubscribeRoom } from '../../sockets/socket.actions'
import {
  LAST_BLOCK_NUMBER,
  USERS_COUNT,
  CONTRACTS_COUNT,
  TRANSACTIONS_COUNT,
  BLOCKS_PROPOGATION,
  BLOCKS_DIFFICULTY,
  BLOCKS_FREQUENCY
} from '../../sockets/rooms'
/*const tourSteps = [
  {
    title: 'Welcome to STRATO!',
    text: '<strong>STRATO</strong> makes it easy to create and manage your custom blockchains.<br><br><strong>Ready to get started?</strong>',
    selector: '#tour-welcome',
    position: 'bottom', type: 'hover',
    isFixed: true,
  },
  {
    title: 'Adding Users',
    text: 'Before you write a Smart Contract, you must add some users that your Smart Contract will interact with.<br><br>For example, if you are splitting the bill for a monthly apartment rental, you might add <i>Roommate 1</i>, <i>Roommate 2</i>, and <i> Roommate 3.</i>',
    selector: '#accounts',
    position: 'bottom', type: 'hover',
    isFixed: true,
  },
];*/

class Dashboard extends Component {

  componentDidMount() {
    this.props.subscribeRoom(LAST_BLOCK_NUMBER)
    this.props.subscribeRoom(USERS_COUNT)
    this.props.subscribeRoom(CONTRACTS_COUNT)
    this.props.subscribeRoom(BLOCKS_PROPOGATION)
    this.props.subscribeRoom(BLOCKS_FREQUENCY)
    this.props.subscribeRoom(BLOCKS_DIFFICULTY)
    this.props.subscribeRoom(TRANSACTIONS_COUNT)
    
    this.props.fetchBlockData();
    this.props.fetchAccounts(false, false);
    mixpanelWrapper.track('dashboard_page_load');
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
    this.props.unSubscribeRoom(LAST_BLOCK_NUMBER)
    this.props.unSubscribeRoom(USERS_COUNT)
    this.props.unSubscribeRoom(CONTRACTS_COUNT)
    this.props.unSubscribeRoom(BLOCKS_PROPOGATION)
    this.props.unSubscribeRoom(BLOCKS_FREQUENCY)
    this.props.unSubscribeRoom(BLOCKS_DIFFICULTY) 
    this.props.unSubscribeRoom(TRANSACTIONS_COUNT)  
  }

  startPoll() {
    const dashboardFetchStatus = this.props.fetchBlockData;
    const fetchAccounts = this.props.fetchAccounts;
    this.timeout = setInterval(function () {
      dashboardFetchStatus();
      fetchAccounts(false, false);
    }, env.POLLING_FREQUENCY);
  }

  difficulty(blockData) {
    return Object.values(blockData).map(function (val, i) {
      return { x: i, y: val.difficulty };
    })
  }

  blockPropogation(blockData) {
    let timeData = [];
    let times = Object.values(blockData).map(function (val) {
      return val.timestamp
    });

    var i = 0;
    for (; i < times.length - 1; i++) {
      let obj = { x: i, y: Math.abs((new Date(times[i + 1]).getSeconds()) - (new Date(times[i]).getSeconds())) };
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
      return { x: i, y: val.length };
    })
  }

  txType(blockData) {
    let types = { "FunctionCall": 0, "Transfer": 0, "Contract": 0 };
    blockData.forEach(function (val) {
      val.forEach(v => { types[v.transactionType]++ });
    })
    return Object.getOwnPropertyNames(types).map((type) => {
      return {
        val: types[type],
        type: type
      }
    });
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
    const apiError = this.props.nodes.reduce((acc, node) => acc || node.apiFailure, false);
    const { usersCount, contractsCount, lastBlockNumber } = this.props.dashboard

    return (
      <div className="container-fluid pt-dark" id="tour-welcome">
        {/*
          <Tour name="dashboard" callback={callAfterTour('#accounts', () => {
            this.props.history.push('accounts');
            this.props.endTour('dashboard');
          })} steps={ tourSteps }/>
        */}
        <div className="row">
          <div className="col-sm-9 text-left">
            <h3>Dashboard</h3>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">
            <NumberCard
              number="HEALTH"
              description="Network"
              mode={apiError ? 'warning' : 'success'}
              iconClass={apiError ? 'fa-exclamation-circle' : 'fa-check-circle'}
            />
          </div>
          <div className="col-sm-3">
            <Link to="/blocks">
              <NumberCard
                number={lastBlockNumber}
                description="Last Block"
                iconClass="fa-link"
              />
            </Link>
          </div>
          <div className="col-sm-3">
            <Link to="/accounts">
              <NumberCard
                number={usersCount}
                description="Users"
                iconClass="fa-users"
                className="smd-pointer"
              />
            </Link>
          </div>
          <div className="col-sm-3">
            <Link to="/contracts">
              <NumberCard
                number={contractsCount}
                description="Contracts"
                iconClass="fa-gavel"
                className="smd-pointer"
              />
            </Link>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <br />
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">
            <BarGraph data={difficultyData} label={"Difficulty"} identifier={"Difficulty"} />
          </div>
          <div className="col-sm-3">
            <BarGraph data={txFreqData} number={txCount} label={"Transaction Count"} identifier={"TxCount"} />
          </div>
          <div className="col-sm-3">
            <BarGraph data={blockPropData} units="s" label={"Block Propagation"} identifier={"BlockProp"} />
          </div>
          <div className="col-sm-3">
            <PieChart data={txTypeData} />
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">
            <h3>Nodes</h3>
            {nodes}
          </div>
          <div className="col-sm-9">
            <h3>Recent Transactions</h3>
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
    nodes: state.nodes.nodes,
    accounts: state.accounts.accounts,
    contracts: state.contracts.contracts,
    dashboard: state.dashboard
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {
      fetchBlockData,
      fetchAccounts,
      hideLoading,
      endTour,
      subscribeRoom,
      unSubscribeRoom
    }
  )(Dashboard)
);
