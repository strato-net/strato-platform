import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import SendTokens from '../SendTokens';
import AccountDetail from '../../../AccountDetail';
import {Alert } from '@blueprintjs/core';
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
      this.props.fetchOauthAccountDetail(user.commonName, user.userAddress, this.props.selectedChain);
    }
  }

  render() {
    // if ( this.props.oauthAccount == null) {
  //     <Alert
  //     // {...alertProps}
  //     className="Garrett was here"
  //     cancelButtonText="Back"
  //     confirmButtonText="Login/Register"
  //     icon="trash"
  //     // intent={Intent.DANGER}
  //     isOpen={true}
  //     // loading={isLoading}
  //     // onCancel={this.handleMoveCancel}
  //     onConfirm={() => {window.location.replace("https://keycloak.blockapps.net/auth/realms/mercata-testnet/protocol/openid-connect/auth?client_id=mercata-beta-userx&state=e83fa2c9a7bb03ed1985c10d5e9e4679&nonce=71a5e2b940f1d0f79ddc7eebfb9cadae&scope=openid%20email%20profile&response_type=code&redirect_uri=https%3A%2F%2Fuserx1.mercata-beta.blockapps.net%2Fauth%2Fopenidc%2Freturn");}}
  // >
  //     <p>
  //         Great job! But to use this feature you need to be a logged in user! Not a registered user? Become one for <b> free</b>!
  //     </p>
  // </Alert>
      console.log("Bingo")
    //   // window.location.replace("https://keycloak.blockapps.net/auth/realms/strato-devel/protocol/openid-connect/auth?nonce=9e543014e3592b08e2b3f72a03ee386e&scope=openid%20email%20profile&state=0ec9d0fca305934214ce253f3979f752&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fauth%2Fopenidc%2Freturn&response_type=code&client_id=dev");
    //   }
    // else {
    const filter = this.props.filter;

    const rows = this.props.oauthAccounts.filter(user => {
      if (!user || user === undefined) {
        return false;
      }
      if (!filter) {
        return true;
      }
      return user.commonName.toLowerCase().indexOf(filter) > -1
    })
      .map(function (user, index) {
        const position = index + 1;
        let userClasseName = '';
        if (this.state.selected === position) {
          userClasseName = ' selected';
        }
        // change this
        return (
          <div className="smd-margin-8" key={user.commonName}>
            <div className="row">
              <div className={`pt-card pt-elevation-2 smd-pointer ${userClasseName}`} key={position} onClick={(e) => {
                this.setState({ selected: position });
                this.onUserClick(user, position);
              }}>
                {user.commonName} - {user.organization}
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
// }

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
