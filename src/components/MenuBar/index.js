import React, {Component} from 'react';
import { connect } from 'react-redux';
import './menubar.css';

class MenuBar extends Component {

  render() {
    return (
      <nav className="pt-navbar pt-dark" style={{position: 'fixed', width: '100%'}}>
        <div className="pt-navbar-group pt-align-left">
          <div>
            <span className="pt-icon-large pt-icon-menu smd-sidebar-button" />
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
