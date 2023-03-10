import React, { Component } from 'react';
import {
  fetchAccounts,
  fetchOauthAccounts,
} from './accounts.actions';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import Tour from '../Tour';
import BlocAccounts from './components/BlocAccounts';
import OauthAccounts from './components/OauthAccounts';
import './accounts.css';
import { isOauthEnabled } from '../../lib/checkMode';
import ReactGA from 'react-ga4';
import {Alert } from '@blueprintjs/core';
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
    if (isOauthEnabled()) {
      this.props.fetchOauthAccounts();
    } else {
      this.props.fetchAccounts(true, true, this.props.selectedChain);
    }
    mixpanelWrapper.track('accounts_page_load');
    ReactGA.send({hitType: "pageview", page: "/accounts", title: "Accounts"});
  }

  render() {
    console.log("In Accounts tab", this.props.isLoggedIn)
    return (
      <div className="container-fluid pt-dark">
        <Tour
          name="accounts"
          steps={tourSteps}
          finalStepSelector='#contracts'
          nextPage='chains' />
        {!isOauthEnabled() ?  <BlocAccounts /> : (this.props.oauthUser.isLoggedIn ? <OauthAccounts />  : 
          (<Alert
            // {...alertProps}
            className="Garrett was here"
            cancelButtonText="Back"
            confirmButtonText="Login/Register"
            icon="trash"
            isOpen={true}
            onCancel={()  => window.history.back()} 
            onConfirm={() => {window.location.replace("https://keycloak.blockapps.net/auth/realms/mercata-testnet/protocol/openid-connect/auth?client_id=mercata-beta-userx&state=e83fa2c9a7bb03ed1985c10d5e9e4679&nonce=71a5e2b940f1d0f79ddc7eebfb9cadae&scope=openid%20email%20profile&response_type=code&redirect_uri=https%3A%2F%2Fuserx1.mercata-beta.blockapps.net%2Fauth%2Fopenidc%2Freturn");}}
          >
              <p>
                  Great job! But this is private information! You need to be logged in to use this feature. Not a registered user? Become one for <b> free</b>!
              </p>
          </Alert>) ) 
        }
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {oauthUser: state.user.oauthUser,
    isLoggedIn : state.user.publicKey != "abcde"
  
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      fetchOauthAccounts,
      fetchAccounts
    }
  )(Accounts));
