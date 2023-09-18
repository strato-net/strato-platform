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
import { subscribeRoom, unSubscribeRoom } from '../../sockets/socket.actions';
import { changeHealthStatus } from './dashboard.action'
import {
  LAST_BLOCK_NUMBER,
  USERS_COUNT,
  CONTRACTS_COUNT,
  TRANSACTIONS_COUNT,
  BLOCKS_PROPAGATION,
  BLOCKS_DIFFICULTY,
  BLOCKS_FREQUENCY,
  TRANSACTIONS_TYPE,
  GET_NODE_UPTIME,
  GET_HEALTH,
  GET_SYSTEM_INFO,
  GET_SHARD_COUNT,
} from '../../sockets/rooms'
import { sec2Date } from "../../lib/formatSeconds";
import ReactGA from "react-ga4";
import { Popover, PopoverInteractionKind, Position } from '@blueprintjs/core';
import ValidatorsCard from '../ValidatorsCard';

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
    this.props.subscribeRoom(GET_SHARD_COUNT)

    mixpanelWrapper.track('dashboard_page_load');
    ReactGA.send({hitType: "pageview", page: "/dashboard", title: "Dashboard"});

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
    this.props.unSubscribeRoom(GET_NODE_UPTIME)
    this.props.unSubscribeRoom(GET_SYSTEM_INFO)
    this.props.unSubscribeRoom(GET_SHARD_COUNT)
  }

  render() {
    const difficultyData = this.props.dashboard.blockDifficulty;
    const txCount = this.props.dashboard.transactionsCount;
    const blockPropData = this.props.dashboard.blockPropagation;
    const txTypeData = this.props.dashboard.transactionTypes;
    const { usersCount, contractsCount, lastBlockNumber, shardCount } = this.props.dashboard;
    const uptime = this.props.dashboard.uptime
    const health = this.props.dashboard.healthStatus;
    const systemHealth = this.props.dashboard.systemStatus;
    const systemWarnings = this.props.dashboard.systemWarnings;
    const synced = this.props.appMetadata.metadata ? this.props.appMetadata.metadata.isSynced : false
    const metadata = this.props.appMetadata.metadata
    return (
      <div className="container-fluid pt-dark" id="tour-welcome">
        <Tour name='dashboard' finalStepSelector='#accounts' nextPage='accounts' steps={tourSteps} />
        <div className="row">
          <div className="col-sm-9 text-left">
            <h3>Node Stats</h3>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <br />
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">

            <Popover
              isDisabled={synced && health}
              interactionKind={PopoverInteractionKind.HOVER}
              position={Position.BOTTOM}
              className={'full-width'}
              content={
                <div className={`pt-dark pt-callout smd-pad-8 pt-icon-info-sign pt-intent-${!metadata ? 'danger' : ((!health || !synced) ? 'warning' : 'success')}`}>
                  <h5 className="pt-callout-title">{
                    !metadata ? 'API Disconnected' : !(health) ? 'Warning' : !synced ? 'Node Syncing' : 'Healthy'
                    }</h5>
                  {
                    !metadata ? 'Cannot connect to the Node\'s API' 
                    : !(health) ? (systemWarnings || 'Reason currently unknown') 
                    : !synced ? 'This Node is currently syncing with the network' 
                    : 'Connected to STRATO Mercata'
                  }
            </div>}
            >
              <NumberCard
                number={!metadata ? 'DISCONNECTED' : (health && !systemHealth ? 'UNHEALTHY' : !synced ? 'SYNCING' : 'HEALTHY')}
                description= {sec2Date(uptime)}
                mode={!metadata ? 'danger' : ((!health || !synced) ? 'warning' : 'success')}
                
                iconClass={!metadata ? 'fa-triangle-exclamation' : (!health ? 'fa-exclamation-circle' : !synced ? 'fa-rotate' : 'fa-check-circle')}
                />
              </Popover>
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
                iconClass="fa-file-contract"
                className="smd-pointer"
              />
            </Link>
          </div>
          <div className="col-sm-3">
            <Link to="/shards">
              <NumberCard
                number={shardCount}
                description="Shards"
                iconClass="fa-diagram-project"
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
            <NumberCard
                number={
                  this.props.appMetadata && this.props.appMetadata.nodeInfo ?
                  <div>
                    <p>
                      {this.props.appMetadata.nodeInfo.organization} {this.props.appMetadata.nodeInfo.organizationalUnit} 
                    </p>
                    <p>
                      {this.props.appMetadata.nodeInfo.commonName}
                    </p> 
                  </div>
                  : 'No Identity'}
                description="Node ID"
                iconClass={this.props.appMetadata && this.props.appMetadata.nodeInfo ? 'fa-id-card' : 'fa-exclamation-circle' }
                className={`smd-pointer`}
                mode={this.props.appMetadata && this.props.appMetadata.nodeInfo ? '' : 'pt-intent-warning'}
                textSize='h4'
              />
          </div>
          <div className="col-sm-6">
            <NodeCard />
          </div>
          
        </div>
        
        <div className="row">
          <div className="col-sm-12">
            <hr />
          </div>
        </div>
        <div className="row">
          <div className="col-sm-9 text-left">
            <h3>Network Stats</h3>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">
            <Link to="/blocks">
              <NumberCard
                number={lastBlockNumber}
                description="Blocks"
                iconClass="fa-cube"
              />
            </Link>
          </div>
          <div className="col-sm-3">
            <ValidatorsCard />
          </div>
          <div className="col-sm-6">
            <TransactionList />
          </div>
        </div>

        <div className="row">
          <div className="col-sm-12">
            <hr />
          </div>
        </div>
        <div className="row">
          <div className="col-sm-9 text-left">
            <h3>Historical Stats</h3>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">
            <BarGraph data={txCount} number={txCount[0]} label={"Transactions per Last 15 Blocks"} identifier={"TxCount"} />
          </div>
          <div className="col-sm-3">
            <PieChart data={txTypeData} />
          </div>
          <div className="col-sm-3">
            <BarGraph data={blockPropData} units="s" label={"Block Interval Last 15 Blocks"} identifier={"BlockProp"} />
          </div>
        </div>
    </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    node: state.node,
    dashboard: state.dashboard,
    appMetadata: state.appMetadata,
  };
}

const connected = connect(
  mapStateToProps,
  {
    hideLoading,
    endTour,
    subscribeRoom,
    unSubscribeRoom,
    changeHealthStatus
  }
)(Dashboard)

export default withRouter(connected);
