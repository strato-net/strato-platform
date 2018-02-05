import React, { Component } from 'react';
import { connect } from 'react-redux';
import './applications-card.css'
import { withRouter } from 'react-router-dom';
import { launchApp } from '../Applications/applications.actions';
import { Menu, MenuItem, Popover, Position } from '@blueprintjs/core';
import ReactLoading from 'react-loading';

class ApplicationCard extends Component {

  constructor() {
    super()
    this.state = {
      isOpen: false
    }
  }

  handleClick = () => {
    this.setState({ isOpen: !this.state.isOpen });
  };

  launch(app) {
    if (!this.props.isLoggedIn) {
      this.props.history.push('/login');
      return;
    }
    this.props.launchApp(app.address, app.url)
  }

  render() {
    const { app } = this.props;
    return (
      <div className="pt-card app-card">
        <div className="row">
          <div className="col-sm-2 text-right">
            <i className="fa fa-rocket fa-5x" aria-hidden="true"></i>
          </div>
          <div className="col-sm-10">
            <div className="row">
              <div className="col-sm-10">
                <div className="heading">
                  <strong> {app.appName} </strong> - <span> v{app.version} </span>
                </div>
              </div>
              <div className="col-sm-2">
                <Popover
                  position={Position.BOTTOM}
                  content={
                  <Menu>
                    <MenuItem onClick={this.handleSave} text="Facebook" />
                    <MenuItem onClick={this.handleDelete} text="Twitter" />
                    <MenuItem onClick={this.handleDelete} text="State of Dapps" />
                  </Menu>}
                  popoverClassName={"popoverClassName"}
                >
                  <button
                    className="pt-button pt-intent-primary"
                    onClick={this.handleClick}
                  >
                    Share
                  </button>
                </Popover>
                {app.isLoading ?
                  <ReactLoading type="bars" color="#f5f8fa" className="pull-right" height={0} width={30} /> :
                  <a rel="noopener noreferrer">
                    <button
                      className="pt-button pt-intent-primary pull-right"
                      onClick={() => this.launch(app)}
                    >
                      Launch
                    </button>
                  </a>
                }
              </div>
            </div>
            <div className="neutral-baseline"></div>
            <div className="row content">
              <div className="col-sm-12">
                {app.description}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

}


export function mapStateToProps(state) {
  return {
    isLoading: state.applications.isLoading,
    isLoggedIn: state.user.isLoggedIn,
    url: state.applications.url
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      launchApp
    }
  )(ApplicationCard)
);
