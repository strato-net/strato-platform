import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import SendTokens from '../SendTokens';
import AccountDetail from '../../../AccountDetail';
import {
  fetchOauthAccountDetail,
  resetOauthUserAccount,
  oauthAccountsFilter
} from './oauthAccounts.actions';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';

class OauthAccounts extends Component {

  constructor() {
    super()
    this.state = {
      selected: -1
    }
  }

  updateFilter(filter) {
    this.props.oauthAccountsFilter(filter);
  };

  onUserClick(user, index) {
    if (user && index === this.state.selected) {
      this.props.resetOauthUserAccount(user);
      this.setState({ selected: null });
    } else {
      mixpanelWrapper.track('accounts_row_click');
      this.props.fetchOauthAccountDetail(user.username, user.address, this.props.selectedChain);
    }
  }

  render() {
    const filter = this.props.filter;
    const users = this.props.oauthAccounts;
    const rows = [];

    users.filter(user => {
      if (!filter) {
        return true;
      }
      return user.username.toLowerCase().indexOf(filter) > -1
    })
      .forEach(function (user, index) {
        const position = index + 1;

        let userClasseName = '';
        if (this.state.selected === position) {
          userClasseName = ' selected';
        }

        rows.push(
          <div className="smd-margin-8" key={user.username}>
            <div className="row">
              <div className={`pt-card pt-elevation-2 smd-pointer ${userClasseName}`} key={position} onClick={(e) => {
                this.setState({ selected: position });
                this.onUserClick(user, position);
              }}>
                {user.username}
              </div>
            </div>
          </div>
        );
      }.bind(this));

    return (
      <div>
        <div className="row">
          <div className="col-sm-4 text-left">
            <h3>Accounts</h3>
          </div>
          <div className="col-sm-8 text-right">
            <div className="pt-button-group">
              <SendTokens />
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
                {this.props.oauthAccount && <AccountDetail />}
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
    oauthAccounts: state.accounts.oauthAccounts,
    filter: state.oauthAccounts.filter,
    selectedChain: state.chains.selectedChain,
    oauthAccount: state.oauthAccounts.account
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      fetchOauthAccountDetail,
      resetOauthUserAccount,
      oauthAccountsFilter
    }
  )(OauthAccounts));
