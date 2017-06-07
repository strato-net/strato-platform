import React, {Component} from 'react';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import './menubar.css';
import logo from './blockapps-cube-color-430x500.png';

class MenuBar extends Component {

  render() {
    return (
      <nav className="pt-navbar pt-dark" style={{position: 'fixed', width: '100%'}}>
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
          <span className="pt-button pt-minimal pt-icon-user"/>
          <span className="pt-button pt-minimal pt-icon-notifications"/>
          <span className="pt-button pt-minimal pt-icon-cog"/>
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
