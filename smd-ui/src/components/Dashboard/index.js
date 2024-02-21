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
    this.props.subscribeRoom(GET_SYSTEM_INFO);

    mixpanelWrapper.track('dashboard_page_load');
    ReactGA.send({hitType: "pageview", page: "/dashboard", title: "Dashboard"});

  }

  displaySystemMetrics(cpu, memory, filesystem, networkStats, limits) {
    if (cpu && memory && filesystem && networkStats) {
      let maxUsageFilesystem = {};
    
      //when running in the docker container, there is only one fs, however, when running
      //outside of the container, there are multiple - so display one with max use
      maxUsageFilesystem = filesystem.reduce((maxUsage, filesystem) => { 
        return filesystem.use > maxUsage.use ? filesystem : maxUsage;
      }, filesystem[0]);
  
    const isCPUCurrentHealthy = cpu.currentLoad < limits.cpuCurrentLoadAlertLevel;
    const isMemoryHealthy = memory.use < limits.memoryUsedAlertLevel;
    const isDiskSpaceHealthy = maxUsageFilesystem.use < limits.diskspaceUsedAlertLevel;

    const healthy = isCPUCurrentHealthy && isMemoryHealthy && isDiskSpaceHealthy;

      return (
        <div className="sys-info-container col-sm-6 text-right row" style={{marginTop: '25px', marginBottom:'10px', marginLeft:'0px', marginRight:'0px' }}>
            <p className='text-right'> 
              <span id='cpuCurrentMetric' className={`metric ${isCPUCurrentHealthy ? 'good-metric' : 'bad-metric'}`}>
                  {`CPU: ${cpu.currentLoad.toFixed(2)}%`}
              </span>
              {' | '}
              <span id='memoryMetric' className={`metric ${isMemoryHealthy ? 'good-metric' : 'bad-metric'}`}>
                  {`Mem: ${memory.use.toFixed(2)}%`}
              </span>
              { ' | '}
              <span id='diskpaceMetric' className={`metric ${isDiskSpaceHealthy ? 'good-metric' : 'bad-metric'}`}>
                  {`Disk: ${maxUsageFilesystem.use.toFixed(2)}%`}
              </span>
              { ' | '}
              {healthy ? <i className="fa-solid fa-circle-check healthy-network"/> : <i className="fa-solid fa-circle-exclamation unhealthy-network"/>}
            </p>
        </div>
     )
    } else {
      return (  
          <div className="sys-info-container row col-sm-6 text-right" style={{marginTop: '25px', marginBottom:'10px', marginLeft:'0px', marginRight:'0px'}}>
              <p className="text-right">System Metrics Loading...</p>
          </div>
      )
    } 
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
    const { usersCount, contractsCount, lastBlockNumber } = this.props.dashboard;
    const uptime = this.props.dashboard.uptime
    const health = this.props.dashboard.healthStatus;
    const systemHealth = this.props.dashboard.systemStatus;
    const systemWarnings = this.props.dashboard.systemWarnings;
    const { cpu, memory, filesystem, networkStats} = this.props.dashboard.systemStats || {};
    const limits = this.props.dashboard.limits || {
      cpuCurrentLoadAlertLevel: 90,
      memoryUsedAlertLevel: 80,
      diskspaceUsedAlertLevel: 80
    }
    const synced = this.props.appMetadata.metadata ? this.props.appMetadata.metadata.isSynced : false
    const metadata = this.props.appMetadata.metadata

    return (
      <div className="container-fluid pt-dark" id="tour-welcome">
        <Tour name='dashboard' finalStepSelector='#accounts' nextPage='accounts' steps={tourSteps} />
        <div className="row d-flex align-items-center">
          <div className="col-sm-6 text-left">
            <h3>Node Stats</h3>
          </div>
          {this.displaySystemMetrics(cpu, memory, filesystem, networkStats, limits)}
        </div>
        <div className="row">
          <div className="col-sm-12">
            <br />
          </div>
        </div>
        <div className="row">
          <div className="col-sm-4">

            <Popover
              isDisabled={synced && health && systemHealth}
              interactionKind={PopoverInteractionKind.HOVER}
              position={Position.BOTTOM}
              className={'full-width'}
              content={
                <div className={`pt-dark pt-callout smd-pad-8 pt-icon-info-sign pt-intent-${!metadata ? 'danger' : ((!health || !synced) ? 'warning' : 'success')}`}>
                  <h5 className="pt-callout-title">{
                    !metadata ? 'API Disconnected' : !(health) ? 'Warning' : !synced ? 'Node Syncing' : !systemHealth ? "Warning" : 'Healthy'
                     //typically systemHealth becomes false during syncing due to high cpu usage, so putting syshealth check at end of ternary
                    }</h5>
                  {
                    !metadata ? 'Cannot connect to the Node\'s API' 
                    : (!health) ? (systemWarnings || 'Reason currently unknown') 
                    : !synced ? `This Node is currently syncing with the network.${systemWarnings ? ` ${systemWarnings}` : ''}` 
                    : !systemHealth ? (systemWarnings || 'System unhealthy') : 'Connected to STRATO Mercata' 
                    //typically systemHealth becomes false during syncing due to high avg cpu usage, so putting systemHealth check at end of ternary
                  } 
            </div>}
            >
              <NumberCard
                number={!metadata ? 'DISCONNECTED' : (!health ? 'UNHEALTHY' : !synced ? 'SYNCING' : !systemHealth ? 'UNHEALTHY' : 'HEALTHY') 
                //moved systemHealth check to end of ternary to avoid unhealthy status when syncing due to high avg cpu usage
              }
                description= {sec2Date(uptime)}
                mode={!metadata ? 'danger' : ((!health || !synced || !systemHealth) ? 'warning' : 'success')}
                
                iconClass={!metadata ? 'fa-triangle-exclamation' : (!health ? 'fa-exclamation-circle' : !synced ? 'fa-rotate' : (!systemHealth ? 'fa-exclamation-circle': 'fa-check-circle'))}
                />
              </Popover>
            </div>
          <div className="col-sm-4">
            <Link to="/accounts">
              <NumberCard
                number={usersCount}
                description="Users"
                iconClass="fa-users"
                className="smd-pointer"
              />
            </Link>
          </div>
          
          <div className="col-sm-4">
            <Link to="/contracts">
              <NumberCard
                number={contractsCount}
                description="Contracts"
                iconClass="fa-file-contract"
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
          <div className="col-sm-4">
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
          <div className="col-sm-8">
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
