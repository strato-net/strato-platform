import React, { Component } from 'react';
import { connect } from 'react-redux';
import './applications-card.css'
import { withRouter } from 'react-router-dom';
import { launchApp, selectApp } from '../Applications/applications.actions';
import { Menu, MenuItem, Popover, Position, Button } from '@blueprintjs/core';
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
    this.props.launchApp(app.address, app.url)
  }

  shareWithFb(urlToShare) {
    const height = 329;
    const width = 575;
    const top = (window.innerHeight - height) / 2;
    const left = (window.innerWidth - width) / 2;
    const opts = 'status=1, width=' + width + ',height=' + height + ',top=' + top + ',left=' + left;
    window.open('https://www.facebook.com/sharer/sharer.php?u=https%3A//blockapps.net/demo1', 'facebook-share-dialog', opts);
  }

  renderLogin(app) {
    return (
      <Button onClick={() => {
        this.props.selectApp(app);
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
                      <a className="facebook-share-button pt-menu-item pt-popover-dismiss" onClick={this.shareWithFb}>Facebook</a>
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
                {/* TODO: remove this when everything is ready */}
                {/* {(!this.props.isLoggedIn && isModePublic()) ? this.renderLogin(app) : (app.isLoading ? */}
                {(app.isLoading ?
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
    url: state.applications.url
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      launchApp,
      selectApp
    }
  )(ApplicationCard)
);
