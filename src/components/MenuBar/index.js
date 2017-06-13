import React, {Component} from 'react';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanel from 'mixpanel-browser';
import './menubar.css';
import logo from './blockapps-cube-color-430x500.png';

class MenuBar extends Component {

  render() {
    return (
      <nav className="pt-navbar pt-dark smd-menu-bar" >
        <div className="pt-navbar-group pt-align-left">
          <div>
            <Link to="/dashboard">
              <img
                src={logo}
                alt="Blockapps Logo"
                height="32"
                className="smd-menu-logo"
              />
            </Link>
          </div>
        </div>
        <div className="pt-navbar-group pt-align-left">
          <div className="pt-navbar-heading">STRATO Management Dashboard</div>
        </div>
        <div className="pt-navbar-group pt-align-right">
          <span className="pt-navbar-divider"/>
          <Link to="http://developers.blockapps.net/dashboard" target="_blank">
            <button className="pt-button pt-minimal pt-small" onClick={() => {mixpanel.track("docs_click")}}>DOCS</button>
          </Link>
        </div>
      </nav>
    );
  }
}

function mapStateToProps(state) {
  return {
  };
}

export default connect(mapStateToProps)(MenuBar);
