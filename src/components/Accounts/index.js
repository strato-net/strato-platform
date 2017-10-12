import React, {Component} from 'react';
import {fetchAccounts, changeAccountFilter, faucetRequest} from './accounts.actions';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import {connect} from 'react-redux';
import {Text, Tooltip, Position} from '@blueprintjs/core';
import {withRouter} from 'react-router-dom';
import NumberCard from '../NumberCard';
import CreateUser from '../CreateUser';
import SendEther from './components/SendEther';
import {endTour} from '../Tour/tour.actions';
// import { callAfterTour } from '../Tour/tour.helpers';

// import Tour from '../Tour';

// const tourSteps = [
// /* {
//     title: 'Create User',
//     text: 'Create a user here',
//     selector: '#accounts-create-user-button',
//     position: 'bottom', type: 'hover',
//     isFixed: true,
//   }, ) */
//   {
//     title: 'Upload a Smart Contract',
//     text: 'Drag and drop a <strong>.sol</strong> file, and you will be able to manage your Smart Contract from within the STRATO dashboard.',
//    /* text: '<div class="inline-code-sample">contract RentSplit {<br>address <strong>Roommate 1</strong>;<br><strong>Roommate 2</strong>;<br><strong>Roommate 3</strong>;<br>mapping (address => uint) RentSplit;<br></div>', */
//     selector: '#contracts',
//     position: 'bottom',
//     isFixed: true,
//   },
// ];

class Accounts extends Component {

  componentDidMount() {
    this.props.fetchAccounts();
    mixpanelWrapper.track('accounts_page_load')
  }

  componentWillUnmount() {
  }

  updateFilter(filter) {
    this.props.changeAccountFilter(filter);
  };

  render() {
    const accounts = this.props.accounts;
    const filter = this.props.filter;
    const history = this.props.history;
    const faucetRequest = this.props.faucetRequest;
    const users = Object.getOwnPropertyNames(accounts);
    const rows = [];

    function handleClick(user, address) {
      mixpanelWrapper.track('accounts_row_click');
      history.push('/accounts/' + user + '/' + address);
    }

    users.forEach(function (user) {
      const addresses = Object.getOwnPropertyNames(accounts[user]);

      addresses
        .filter(function (address) {
          if (!filter) {
            return true;
          }
          return user.toLowerCase().indexOf(filter) > -1
            || address.toLowerCase().indexOf(filter) > -1;
        })
        .forEach(function (address) {
          if (address === 'error') {
            return;
          }
          rows.push(
            <tr key={address} onClick={(e) => handleClick(user, address)}>
              <td>
                <button
                  className="pt-button pt-intent-primary pt-small"
                  onClick={(e) =>
                    {
                      e.preventDefault();
                      e.stopPropagation();
                      faucetRequest(address); 
                    }
                  }
                >
                  Faucet
                </button>
              </td>
              <td>
                <Text ellipsize={true}>
                  <Tooltip tooltipClassName="smd-padding-8" content={user} position={Position.TOP_LEFT}>
                    <small>{user}</small>
                  </Tooltip>
                </Text>
              </td>
              <td>
                <Text ellipsize={true}>
                  <Tooltip tooltipClassName="smd-padding-8" content={address} position={Position.TOP_LEFT}>
                    <small>{address}</small>
                  </Tooltip>
                </Text>
              </td>
              <td>
                <Text ellipsize={true}>
                  <Tooltip tooltipClassName="smd-padding-8" content={accounts[user][address].balance} position={Position.TOP_LEFT}>
                    <small>{accounts[user][address].balance} wei</small>
                  </Tooltip>
                </Text>
              </td>
            </tr>
          );
        });
    });


    return (
      <div className="container-fluid pt-dark">
        {/*
        <Tour name="accounts" steps={tourSteps} callback={ callAfterTour('#contracts', () => {
            this.props.history.push('contracts');
            this.props.endTour('accounts');
          })}
        />
        */}
        <div className="row">
          <div className="col-sm-4 text-left">
            <h3>Accounts</h3>
          </div>
          <div className="col-sm-8 text-right">
            <div className="pt-button-group">
              <SendEther/>
              <CreateUser />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">
            <NumberCard
              number={users.length}
              description="Users"
              iconClass="fa-users"
            />
          </div>
          <div className="col-sm-9">
            <div className="pt-card pt-elevation-2">
              <div className="pt-input-group pt-dark pt-large">
                <span className="pt-icon pt-icon-search"></span>
                <input
                  className="pt-input"
                  type="search"
                  placeholder="Search accounts"
                  onChange={e => this.updateFilter(e.target.value.toLowerCase())}
                  dir="auto"/>
              </div>
              <table className="pt-table pt-interactive pt-condensed pt-striped" style={{tableLayout: 'fixed', width: '100%'}}>
                <thead>
                <tr>
                  <th></th>
                  <th><h4>Username</h4></th>
                  <th><h4>Account</h4></th>
                  <th><h4>Balance</h4></th>
                </tr>
                </thead>

                <tbody>
                  {rows.length === 0 ? <tr><td colSpan={3}>No Accounts</td></tr> : rows}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <br/>
          </div>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    accounts: state.accounts.accounts,
    filter: state.accounts.filter
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {
      fetchAccounts,
      changeAccountFilter,
      endTour,
      faucetRequest
    }
  )(Accounts)
);
