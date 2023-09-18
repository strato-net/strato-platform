import React, { Component } from 'react';
import MenuBar from '../components/MenuBar'
import SideBar from '../components/SideBar'
import { routes as scenes } from '../routes';
import mixpanelWrapper from '../lib/mixpanelWrapper';
import './App.css';
import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';
import '@blueprintjs/table/dist/table.css';
import 'bootstrap/dist/css/bootstrap.css';
import { env } from '../env';
import LoadingBar from 'react-redux-loading-bar'
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { isOauthEnabled } from '../lib/checkMode';
import { getOrCreateOauthUserRequest, getUserCertificateRequest } from '../components/User/user.actions';
import { fetchHealth, fetchMetadata } from './app.actions';
import ReactGA from "react-ga4";

ReactGA.initialize("G-PWGS3Z6YNQ");
mixpanelWrapper.init('62f1bec01cdb0096be8e8bdd693e0081');
mixpanelWrapper.identify(env.NODE_NAME);

class App extends Component {

  componentDidMount() {
    if (isOauthEnabled()) {
      this.props.getOrCreateOauthUserRequest();
    }
    this.props.fetchMetadata()
    this.props.fetchHealth()
  }

  constructor(){
    super()
    this.state = {
      isCollapsed: true
    }
  }

  toggleCollapse = () => {
    this.setState(prevState => ({isCollapsed: !prevState.isCollapsed}))
  }

  render() {
    const collapsePoint = 800; //in px
    return (
      <div className="App" >
        <LoadingBar style={{ top: '0px', backgroundColor: '#62d96b', zIndex: 999, height: '4px' }} />
        <MenuBar isCollapsed={this.state.isCollapsed} toggleCollapse={this.toggleCollapse}/>
        <SideBar isCollapsed={this.state.isCollapsed} toggleCollapse={this.toggleCollapse}/>
        <main id="outer-container">
          {scenes}
        </main>
      </div>
    );
  }
}

// connect user cert state to props
export function mapStateToProps(state) {
  return ({
    oauthUser: state.user.oauthUser,
    userCertificate: state.user.userCertificate,
    appMetadata: state.appMetadata,
  })
}

export default withRouter(connect(mapStateToProps, {
  getOrCreateOauthUserRequest,
  fetchHealth,
  fetchMetadata
})(App));
