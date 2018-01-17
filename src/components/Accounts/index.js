import React, { Component } from 'react';
import { fetchAccounts, changeAccountFilter, faucetRequest, fetchUserAddresses, fetchAccountDetail } from './accounts.actions';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import NumberCard from '../NumberCard';
import CreateUser from '../CreateUser';
import SendEther from './components/SendEther';
import HexText from '../HexText';
import Tour from '../Tour';

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

  render() {
    const accounts = this.props.accounts;
    const filter = this.props.filter;
    const history = this.props.history;
    const faucetRequest = this.props.faucetRequest;
    const users = Object.getOwnPropertyNames(accounts);
    const rows = [];
    const self = this
    function handleClick(user, address) {
      mixpanelWrapper.track('accounts_row_click');
      self.props.fetchUserAddresses(user, true)
    }

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
        rows.push(
          <div className="row" style={{ marginBottom: 5 }}>
            <div className="pt-card pt-elevation-2 col-sm-4" key={index} onClick={(e) => handleClick(user)}>
              {user}
            </div>
            <div className="col-sm-8">
              {
                addresses.length > 0 && addresses.map(address => {
                  const account = Object.getOwnPropertyNames(accounts).indexOf(user) >= 0 ? accounts[user][address] : {}
                  return < div className="pt-card" >
                    <div>{address}</div>
                    <button
                      className="pt-button pt-intent-primary pt-small"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        faucetRequest(user, address);
                      }}>
                      Faucet
                  </button>

                    <table className="pt-table pt-str">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td><strong>Contract Root</strong></td>
                          <td><HexText value={account.contractRoot} classes="smd-pad-2" /></td>
                        </tr>
                        <tr>
                          <td><strong>Kind</strong></td>
                          <td>{account.kind}</td>
                        </tr>
                        <tr>
                          <td><strong>Balance</strong></td>
                          <td>{account.balance}</td>
                        </tr>
                        <tr>
                          <td><strong>Latest Block Number</strong></td>
                          <td>{account.latestBlockNum}</td>
                        </tr>
                        <tr>
                          <td><strong>Code Hash</strong></td>
                          <td><HexText value={account.codeHash} classes="smd-pad-2" /></td>
                        </tr>
                        <tr>
                          <td><strong>Nonce</strong></td>
                          <td>{account.nonce}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                })}
            </div>
          </div>
        );
      });

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
              <div className="col-sm-12">
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

export default withRouter(connect(mapStateToProps, { fetchAccountDetail, fetchUserAddresses, fetchAccounts, changeAccountFilter, faucetRequest })(Accounts));
