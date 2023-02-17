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
    return (
      <div className="container-fluid pt-dark">
        <Tour
          name="accounts"
          steps={tourSteps}
          finalStepSelector='#contracts'
          nextPage='chains' />
        {isOauthEnabled() ? <OauthAccounts /> : <BlocAccounts />}
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {};
}

export default withRouter(
  connect(mapStateToProps,
    {
      fetchOauthAccounts,
      fetchAccounts
    }
  )(Accounts));
