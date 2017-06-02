import React, {Component} from 'react';
import { connect } from 'react-redux';
import './menubar.css';

class MenuBar extends Component {

  render() {
    return (
      <nav className="pt-navbar pt-dark" style={{position: 'fixed', width: '100%'}}>
        <div className="pt-navbar-group pt-align-left">
          <div>
            <a href="http://blockapps.net" target="_blank" rel="noopener noreferrer">
              <img
                src="images/blockapps-cube-color-430x500.png"
                alt="Blockapps Logo"
                height="32"
                className="smd-menu-logo"
              />
            </a>
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
