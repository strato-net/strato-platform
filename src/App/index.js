import React, { Component } from 'react';
import MenuBar from '../components/MenuBar'
import SideBar from '../components/SideBar'
import {routes as scenes} from '../routes';
import mixpanelWrapper from '../lib/mixpanelWrapper';
import './App.css';
import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';
import '@blueprintjs/table/dist/table.css';
import 'bootstrap/dist/css/bootstrap.css';
import { env } from '../env';
import LoadingBar from 'react-redux-loading-bar'
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';

mixpanelWrapper.init('62f1bec01cdb0096be8e8bdd693e0081');
mixpanelWrapper.identify(env.NODE_NAME);

class App extends Component {

  sideBar() {
    return this.props.isLoggedIn ? <SideBar /> : null
  }

  render() {
    return (
      <div className="App" >
        <LoadingBar style={{top: '0px', backgroundColor: '#5279c7', zIndex: 999}} />
        <MenuBar />
        { this.sideBar() }
        <main id="outer-container">
          {scenes}
        </main>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    isLoggedIn: state.account.isLoggedIn
  };
}

export default withRouter(connect(mapStateToProps)(App));
