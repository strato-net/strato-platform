import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';
import NodeCard from '../NodeCard';
import TransactionList from '../TransactionList';
import NumberCard from '../NumberCard';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { endTour } from '../Tour/tour.actions';
// import { callAfterTour } from '../Tour/tour.helpers';
// import Tour from '../Tour';
import Tour from '../Tour';
import { env } from '../../env'
import io from 'socket.io-client';
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
  BLOCKS_PROPAGATION,
  BLOCKS_DIFFICULTY,
  BLOCKS_FREQUENCY,
  TRANSACTIONS_TYPE,
  GET_NODE_UPTINE,
  GET_HEALTH,
  GET_SYSTEM_INFO
} from '../../sockets/rooms'
import {sec2Date} from "../../lib/formatSeconds";

const socket = io(env.SOCKET_SERVER, { path: '/apex-ws', transports: ['websocket'] });
// TODO: these should be part of a reducer state. Do the same for other global variables.
const tourSteps = [
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
];

class Dashboard extends Component {

  constructor(props) {
    super(props);
    this.handleMouseHover = this.handleMouseHover.bind(this);
    this.state = {
      isHovering: false,
    }
  }
  componentDidMount() {
    this.props.subscribeRoom(LAST_BLOCK_NUMBER)
    this.props.subscribeRoom(USERS_COUNT)
    this.props.subscribeRoom(CONTRACTS_COUNT)
    this.props.subscribeRoom(BLOCKS_PROPAGATION)
    this.props.subscribeRoom(BLOCKS_FREQUENCY)
    this.props.subscribeRoom(BLOCKS_DIFFICULTY)
    this.props.subscribeRoom(TRANSACTIONS_COUNT)
    this.props.subscribeRoom(TRANSACTIONS_TYPE)
    this.props.subscribeRoom(GET_HEALTH)
    this.props.subscribeRoom(GET_NODE_UPTINE)
    this.props.subscribeRoom(GET_SYSTEM_INFO)

    mixpanelWrapper.track('dashboard_page_load');
  }

  componentWillUnmount() {
    this.props.unSubscribeRoom(LAST_BLOCK_NUMBER)
    this.props.unSubscribeRoom(USERS_COUNT)
    this.props.unSubscribeRoom(CONTRACTS_COUNT)
    this.props.unSubscribeRoom(BLOCKS_PROPAGATION)
    this.props.unSubscribeRoom(BLOCKS_FREQUENCY)
    this.props.unSubscribeRoom(BLOCKS_DIFFICULTY)
    this.props.unSubscribeRoom(TRANSACTIONS_COUNT)
    this.props.unSubscribeRoom(TRANSACTIONS_TYPE)
    this.props.unSubscribeRoom(GET_HEALTH)
    this.props.unSubscribeRoom(GET_NODE_UPTINE)
    this.props.unSubscribeRoom(GET_SYSTEM_INFO)
  }

  handleMouseHover (){
    this.setState({
      isHovering: !this.state.isHovering
    });
  };

  render() {
    const difficultyData = this.props.dashboard.blockDifficulty;
    const txCount = this.props.dashboard.transactionsCount;
    const blockPropData = this.props.dashboard.blockPropagation;
    const txTypeData = this.props.dashboard.transactionTypes;
    const { usersCount, contractsCount, lastBlockNumber } = this.props.dashboard;
    const uptime = this.props.dashboard.uptime;
    const health = this.props.dashboard.healthStatus;
    const systemHealth = this.props.dashboard.systemStatus;
    const systemWarnings = this.props.dashboard.systemWarnings;
    
    return (
      <div className="container-fluid pt-dark" id="tour-welcome">
        <Tour name='dashboard' finalStepSelector='#accounts' nextPage='accounts' steps={tourSteps} />
        <div className="row">
          <div className="col-sm-9 text-left">
            <h3>Network</h3>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3"
               onMouseEnter={this.handleMouseHover}
               onMouseLeave={this.handleMouseHover}
          >
            <NumberCard
              number={health ? 'HEALTHY' : 'UNHEALTHY'}
              description= {uptime ? sec2Date(uptime) : ''}
              mode={(health && systemHealth) ? 'success':'warning' }
              iconClass={(health && systemHealth) ? 'fa-check-circle' : 'fa-exclamation-circle'}
            />
            {(this.state.isHovering && !systemHealth) && <div> Warnings: {systemWarnings} </div>}
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
            <BarGraph data={txCount} number={txCount[0]} label={"Transaction Count"} identifier={"TxCount"} />

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
            <NodeCard />
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

export function mapStateToProps(state) {
  return {
    node: state.node,
    dashboard: state.dashboard
  };
}

const connected = connect(
  mapStateToProps,
  {
    hideLoading,
    endTour,
    subscribeRoom,
    unSubscribeRoom
  }
)(Dashboard)

export default withRouter(connected);
