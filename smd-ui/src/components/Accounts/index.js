import React, { Component } from 'react';
import { fetchAccounts, changeAccountFilter, fetchUserAddresses, fetchAccountDetail, resetUserAddress } from './accounts.actions';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import SendTokens from './components/SendTokens';
import Tour from '../Tour';
import Account from '../Account';
import CreateBlocUser from '../CreateBlocUser';
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

  constructor() {
    super()
    this.state = {
      selected: 0
    }
  }

  componentDidMount() {
    this.props.fetchAccounts(true, true, this.props.selectedChain);
    mixpanelWrapper.track('accounts_page_load')
  }

  updateFilter(filter) {
    this.props.changeAccountFilter(filter);
  };

  onUserClick(user, address, index) {
    if (address.length && index === this.state.selected) {
      this.props.resetUserAddress(user);
      this.setState({ selected: null });
    } else {
      mixpanelWrapper.track('accounts_row_click');
      this.props.fetchUserAddresses(user, true, this.props.selectedChain)
    }
  }

  render() {
    const accounts = this.props.accounts;
    const filter = this.props.filter;
    const users = Object.getOwnPropertyNames(accounts);
    const rows = [];
    const selectedAddresses = [];

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
        let userClasseName = '';
        if (this.state.selected === index && addresses.length > 0) {
          userClasseName = ' selected';
          addresses.map(address =>
            selectedAddresses.push(<Account name={user} address={address} key={address} />)
          );
        }

        rows.push(
          <div className="smd-margin-8" key={user}>
            <div className="row">
              <div className={`pt-card pt-elevation-2 smd-pointer ${userClasseName}`} key={index} onClick={(e) => {
                this.setState({ selected: index });
                this.onUserClick(user, addresses, index);
              }}>
                {user}
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
          nextPage='chains' />

        <div className="row">
          <div className="col-sm-4 text-left">
            <h3>Accounts</h3>
          </div>
          <div className="col-sm-8 text-right">
            <div className="pt-button-group">
              <SendTokens />
              <CreateBlocUser />
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
        </div>
        <div className="container-fluid pt-dark">
          <div className="row">
            <div className="col-sm-4 main-div">
              <div className="accounts-margin-top">
                {rows.length === 0
                  ?
                  <table>
                    <tbody>
                      <tr>
                        <td colSpan={3}>No Accounts</td>
                      </tr>
                    </tbody>
                  </table>
                  : rows}
              </div>
            </div>
            <div className="col-sm-8 account-details">
              <div>
                {selectedAddresses.length ? selectedAddresses : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    accounts: state.accounts.accounts,
    filter: state.accounts.filter,
    selectedChain: state.chains.selectedChain
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
