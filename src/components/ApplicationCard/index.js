import React, { Component } from 'react';
import { connect } from 'react-redux';
import './applications-card.css'
import { withRouter } from 'react-router-dom';
import { launchApp, selectApp } from '../Applications/applications.actions';
import { Menu, MenuItem, Popover, Position, Button } from '@blueprintjs/core';
import ReactLoading from 'react-loading';
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

  shareWithFb(urlToShare) {
    window.FB.ui({
      method: 'share_open_graph',
      action_type: 'og.likes',
      action_properties: JSON.stringify({
        object: {
          'og:url': 'https://www.facebook.com/sharer/sharer.php?u=https%3A//blockapps.net/demo1', // your url to share
          'og:title': 'Blockapps',
          'og:description': 'To restore to digital transactions the reliability and efficiency of face-to-face interactions through secure and connected information.',
        }
      }),
    }, function (response) {
      // Debug response (optional)
      console.log(response);
    });
  }

  renderLogin(app) {
    return (
      <Button onClick={() => {
        this.props.selectApp(app)
        this.props.openLoginOverlay();
      }} className="pt-intent-primary"
        id="Login-button"
        text={'Launch'} />
    );
  }

  render() {
    const { app } = this.props;
    const urlToShare = window.location.origin + app.url
    const twitterUrl = "https://twitter.com/intent/tweet?url=" + urlToShare
    return (
      <div className="pt-card app-card">
        <div className="row">
          <div className="col-sm-1 text-center">
            <i className="fa fa-rocket fa-5x" aria-hidden="true"></i>
          </div>
          <div className="col-sm-11">
            <div className="row">
              <div className="col-sm-8">
                <div className="heading">
                  <strong> {app.appName} </strong> - <span> v{app.version} </span>
                </div>
              </div>
              <div className="col-sm-4 launchAndShare">
                <Popover
                  position={Position.BOTTOM}
                  content={
                    <Menu>
                      <MenuItem onClick={() => this.shareWithFb(urlToShare)} text="Facebook" />
                      <a className="twitter-share-button pt-menu-item pt-popover-dismiss"
                        href={twitterUrl}
                        data-size="large"
                        data-text="custom share text"
                        data-url="https://twitter.com/intent/tweet?text=Check%20out%20my%20app%20on%20STRATO%20Public!%20http://blockapps.net/demo1"
                        data-hashtags="example,demo"
                        data-via="twitterdev"
                        data-related="twitterapi,twitter">
                        Tweet
                        </a>
                      <MenuItem onClick={() => { window.open('https://www.stateofthedapps.com/dapps/new/form', '_blank') }} text="State of Dapps" />
                    </Menu>}
                  popoverClassName={"popoverClassName"}
                  className={"share-popover"}
                >
                  <button
                    className="pt-button pt-intent-primary pull-right"
                    onClick={this.handleClick}
                  >
                    Share
                  </button>
                </Popover>
                {!this.props.isLoggedIn ? this.renderLogin(app) : (app.isLoading ?
                  <span className="launch-loader"> <ReactLoading type="bars" color="#f5f8fa" className="pull-right" height={0} width={30} /> </span> :
                  <button
                    className="pt-button pt-intent-primary pull-right"
                    onClick={() => this.launch(app)}
                  >
                    Launch
                  </button>)
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
      openLoginOverlay,
      selectApp
    }
  )(ApplicationCard)
);
