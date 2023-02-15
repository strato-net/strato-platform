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
import { withRouter, useLocation } from 'react-router-dom';
import { isOauthEnabled } from '../lib/checkMode';
import { getOrCreateOauthUserRequest } from '../components/User/user.actions';
import { getUserFromLocal } from '../lib/localStorage';
// for google analytics support vvv
import { createBrowserHistory } from "history";
import ReactGA from "react-ga4";
ReactGA.initialize("G-PWGS3Z6YNQ");
// version 1: uses history
// pros: no need to update versions on any other dependencies
// // cons: soooo ugly
// const history = createBrowserHistory();
// history.listen(location => {
//   //window.location.href.split("#",2)[1]
//   // alert(window.location.href.split("#",2)[1]);
//   ReactGA.set({ page: window.location.href.split("#",2)[1] });
//   ReactGA.send({hitType: "pageview", page: window.location.href.split("#",2)[1]});
// });

// version 2: uses `useLocation` webhook from react-router-dom
// pros: cleaner
// cons: lots of dependency updates -> break anything?
// function Test(props) {
//   const location = useLocation();
//   alert(location.pathname);
//   ReactGA.send({hitType: "pageview", page: location.pathname, title: "Hellloooo"});
//   return null;
// }



mixpanelWrapper.init('62f1bec01cdb0096be8e8bdd693e0081');
mixpanelWrapper.identify(env.NODE_NAME);

class App extends Component {

  componentDidMount() {
    if (isOauthEnabled() && !getUserFromLocal()) {
      this.props.getOrCreateOauthUserRequest();
    }
  }

  componentWillUnmount() {
    console.log("unmountung app...");
    ReactGA.send({hitType: "timing", timingCategory: "page_view", timingVar: "engagement_time_msec", timingValue: 200000});
    alert("unmounting App...");
  }

  render() {
    return (
      <div className="App" >
        {/* <Test></Test> */}
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
