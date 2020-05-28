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
import { getOrCreateOauthUserRequest } from '../components/User/user.actions';
import { getUserFromLocal } from '../lib/localStorage';

mixpanelWrapper.init('62f1bec01cdb0096be8e8bdd693e0081');
mixpanelWrapper.identify(env.NODE_NAME);

class App extends Component {

  componentDidMount() {
    if (isOauthEnabled() && !getUserFromLocal()) {
      this.props.getOrCreateOauthUserRequest();
    }
  }

  render() {
    return (
      <div className="App" >
        <LoadingBar style={{ top: '0px', backgroundColor: '#62d96b', zIndex: 999, height: '4px' }} />
        <MenuBar />
        <SideBar />
        <main id="outer-container">
          {scenes}
        </main>
      </div>
    );
  }
}

export function mapStateToProps() {
  return ({})
}

export default withRouter(connect(mapStateToProps, {
  getOrCreateOauthUserRequest
})(App));
