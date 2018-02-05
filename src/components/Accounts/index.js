import React, { Component } from 'react';
import { fetchAccounts, changeAccountFilter, fetchUserAddresses, fetchAccountDetail, resetUserAddress } from './accounts.actions';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import CreateUser from '../CreateUser';
import SendEther from './components/SendEther';
import Tour from '../Tour';
import Account from '../Account';
import './accounts.css';

const tourSteps = [/* {
    title: 'Create User',
    text: 'Create a user here',
    selector: '#accounts-create-user-button',
    position: 'bottom', type: 'hover',
    isFixed: true,
  }, ) */
  {
    title: 'Upload a Smart Contract',
    text: 'Drag and drop a <strong>.sol</strong> file, and you will be able to manage your ' +
      'Smart Contract from within the STRATO dashboard.',
    /* text: '<div class="inline-code-sample">contract RentSplit {<br>address <strong>Roommate 1</strong>;<br><strong>Roommate 2</strong>;<br><strong>Roommate 3</strong>;<br>mapping (address => uint) RentSplit;<br></div>', */
    selector: '#contracts',
    position: 'bottom',
    isFixed: true
  }
];

class Accounts extends Component {
  componentDidMount() {
    this.props.fetchAccounts(true, true);
    mixpanelWrapper.track('accounts_page_load')
  }

  updateFilter(filter) {
    this.props.changeAccountFilter(filter);
  };

  onUserClick(user, address) {
    if (address.length) {
      this.props.resetUserAddress(user);
    } else {
      mixpanelWrapper.track('accounts_row_click');
      this.props.fetchUserAddresses(user, true)
    }
  }

  render() {
    const accounts = this.props.accounts;
    const filter = this.props.filter;
    const users = Object.getOwnPropertyNames(accounts);
    const rows = [];

    users.filter(user => {
      if (!filter) {
        return true;
      }
      return user
        .toLowerCase()
        .indexOf(filter) > -1
    })
      .forEach(function (user, index) {
        const addresses = Object.getOwnPropertyNames(accounts[user]);
        let userClasseName = addresses.length > 0 ? " selected" : "";

        rows.push(
          <div className="smd-margin-8" key={user}>
            <div className="row">
              <div className={`pt-card pt-elevation-2 col-sm-4 smd-pointer ${userClasseName}`} key={index} onClick={(e) => this.onUserClick(user, addresses)}>
                {user}
              </div>
              <div className="col-sm-8">
                {
                  addresses.length > 0 && addresses.map(address => {
                    return <Account name={user} address={address} key={address} />
                  })}
              </div>
            </div>
          </div>
        );
      }.bind(this));

    return (
      <div className="container-fluid pt-dark">
        <Tour
          name="accounts"
          steps={tourSteps}
          finalStepSelector='#contracts'
          nextPage='contracts' />
        <div className="row">
          <div className="col-sm-4 text-left">
            <h3>Accounts</h3>
          </div>
          <div className="col-sm-8 text-right">
            <div className="pt-button-group">
              <SendEther />
              <CreateUser />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-4">
            <div className="pt-input-group pt-dark pt-large">
              <span className="pt-icon pt-icon-search"></span>
              <input
                className="pt-input"
                type="search"
                placeholder="Search accounts"
                onChange={e => this.updateFilter(e.target.value.toLowerCase())}
                dir="auto" />
            </div>
          </div>
          <div className="container-fluid pt-dark">
            <div className="row">
              <div className="col-sm-12 accounts-margin-top">
                {rows.length === 0
                  ? <tr>
                    <td colSpan={3}>No Accounts</td>
                  </tr>
                  : rows}
              </div>
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <br />
          </div>
        </div>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    accounts: state.accounts.accounts,
    filter: state.accounts.filter
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      fetchAccountDetail,
      fetchUserAddresses,
      fetchAccounts,
      changeAccountFilter,
      resetUserAddress
    }
  )(Accounts));
