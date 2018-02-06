import React, { Component } from 'react';
import { connect } from 'react-redux';
import './applications-card.css'
import { withRouter } from 'react-router-dom';
import { launchApp } from '../Applications/applications.actions';
import { Menu, MenuItem, Popover, Position, Button } from '@blueprintjs/core';
import ReactLoading from 'react-loading';
import Login from '../Login';
import { openLoginOverlay } from '../User/user.actions';

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
    this.props.launchApp(app.address, app.url)
  }

  shareWithFb() {
    window.FB.ui({
      method: 'share_open_graph',
      action_type: 'og.likes',
      action_properties: JSON.stringify({
        object: this.props.app.url,
      })
    }, function (response) {
      // Debug response (optional)
      console.log(response);
    });
  }

  renderLogin() {
    return (
      <Button onClick={() => {
        if (this.props.isLoggedIn) {
          this.props.history.replace('/apps');
        } else {
          this.props.openLoginOverlay();
        }
      }} className="pt-intent-primary"
        id="Login-button"
        text={'Launch'} />
    );
  }

  render() {
    const { app } = this.props;
    // http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/
    const twitterUrl = "https://twitter.com/intent/tweet?url=" + app.url
    console.log('Lets check:', app)
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
                      <MenuItem onClick={this.shareWithFb} text="Facebook" />
                      <a className="twitter-share-button pt-menu-item pt-popover-dismiss"
                        href={twitterUrl}
                        data-size="large"
                        data-text="custom share text"
                        data-url="https://dev.twitter.com/web/tweet-button"
                        data-hashtags="example,demo"
                        data-via="twitterdev"
                        data-related="twitterapi,twitter">
                        Tweet
                        </a>
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
                {!this.props.isLoggedIn? this.renderLogin() : (app.isLoading ?
                  <ReactLoading type="bars" color="#f5f8fa" className="pull-right" height={0} width={30} /> :
                  <a rel="noopener noreferrer">
                    <button
                      className="pt-button pt-intent-primary pull-right"
                      onClick={() => this.launch(app)}
                    >
                      Launch
                    </button>
                  </a>)
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
      launchApp,
      openLoginOverlay
    }
  )(ApplicationCard)
);
