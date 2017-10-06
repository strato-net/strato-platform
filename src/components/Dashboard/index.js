import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';
import NodeCard from '../NodeCard';
import TransactionList from '../TransactionList';
import NumberCard from '../NumberCard';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { fetchBlockData } from '../BlockData/block-data.actions';
import { fetchAccounts } from '../Accounts/accounts.actions';
import { fetchContracts } from '../Contracts/contracts.actions';
import { endTour } from '../Tour/tour.actions';
import { callAfterTour } from '../Tour/tour.helpers';

import Tour from '../Tour';

import { env } from '../../env';
import BarGraph from '../BarGraph';
import PieChart from '../PieChart';

import './dashboard.css';

const tourSteps = [
  {
    title: 'Welcome!',
    text: 'This is your new dashboard',
    selector: '#tour-welcome',
    position: 'bottom', type: 'hover',
    isFixed: true,
  },
  {
    title: 'Your Accounts',
    text: 'Here are your accounts',
    selector: '#accounts',
    position: 'bottom', type: 'hover',
    isFixed: true,
  },
];

class Dashboard extends Component {

  componentDidMount() {
    this.props.fetchBlockData();
    this.props.fetchAccounts();
    this.props.fetchContracts();
    mixpanelWrapper.track('dashboard_page_load');
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
  }

  startPoll() {
    const dashboardFetchStatus = this.props.fetchBlockData;
    const fetchAccounts = this.props.fetchAccounts;
    const fetchContracts = this.props.fetchContracts;
    this.timeout = setInterval(function () {
      dashboardFetchStatus();
      fetchAccounts();
      fetchContracts();
    }, env.POLLING_FREQUENCY);
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
    return Object.getOwnPropertyNames(types).map((type)=>{
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
    const apiError = this.props.nodes.reduce((acc,node) => acc || node.apiFailure, false);
    const userCount = Object.getOwnPropertyNames(this.props.accounts).length;
    const contractCount = Object.getOwnPropertyNames(this.props.contracts).length;

    return (
      <div className="container-fluid pt-dark" id="tour-welcome">
        <Tour name="dashboard" callback={callAfterTour('#accounts', () => {
          this.props.history.push('accounts');
          this.props.endTour('dashboard');
        })} steps={ tourSteps }/>
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
              mode={ apiError ? 'warning' : 'success' }
              iconClass={ apiError ? 'fa-exclamation-circle' : 'fa-check-circle' }
            />
          </div>
          <div className="col-sm-3">
            <Link to="/blocks">
              <NumberCard
                number={ blockData && blockData.length > 0 ? blockData[0].number.toString() : 'Unknown'}
                description="Last Block"
                iconClass="fa-link"
              />
            </Link>
          </div>
          <div className="col-sm-3">
            <Link to="/accounts">
              <NumberCard
                number={userCount}
                description="Users"
                iconClass="fa-users"
                className="smd-pointer"
              />
            </Link>
          </div>
          <div className="col-sm-3">
            <Link to="/contracts">
              <NumberCard
                number={ contractCount }
                description="Contracts"
                iconClass="fa-gavel"
                className="smd-pointer"
              />
            </Link>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <br/>
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
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {
      fetchBlockData,
      fetchAccounts,
      fetchContracts,
      endTour,
    }
  )(Dashboard)
);
