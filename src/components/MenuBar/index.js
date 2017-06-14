import React, {Component} from 'react';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanel from 'mixpanel-browser';
import './menubar.css';
import logo from './blockapps-cube-color-430x500.png';
import { NODES } from '../../env';

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
          <Link to={ NODES[0].BLOC_DOC_URL } target="_blank">
            <button className="pt-button pt-minimal pt-small" onClick={() => {mixpanel.track("bloc_docs_click")}}>Bloc API</button>
          </Link>
          <Link to={ NODES[0].STRATO_DOC_URL } target="_blank">
            <button className="pt-button pt-minimal pt-small" onClick={() => {mixpanel.track("strato_docs_click")}}>Strato API</button>
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
