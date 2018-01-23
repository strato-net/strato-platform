import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { fetchApps, selectApp } from './apps.actions';
import {
  Button,
  Card,
  FontIcon
} from 'react-md';
import './apps.css';
import { env } from '../../env';

class Apps extends Component {

  componentDidMount() {
    this.props.fetchApps();
  }

  launchApp(url) {
    const user = localStorage.getItem('user')
    const data = JSON.parse(user)
    data && data.username ? window.open(env.LOCAL_URL + url, "_blank") : this.props.history.push('/login');
  }

  render() {
    const { apps } = this.props;

    return (
      apps.map((app, key) => {
        return (
          <div className="md-grid md-toolbar--relative apps" key={key}>
            <div className="md-cell md-cell--3-desktop md-cell--0-tablet" />
            <div className="md-cell md-cell--6-desktop md-cell--8-tablet" style={{ color: 'white' }}>
              <Card style={{ background: '#263238' }}>
                <div className="md-grid align-text-verticle-center">
                  <div className="md-cell md-cell--2-desktop md-cell--1-tablet md-cell--1-phone no-padding icon-app">
                    <FontIcon iconClassName="fa fa-rocket" />
                  </div>
                  <div className="md-cell md-cell--10-desktop md-cell--7-tablet md-cell--3-phone">
                    <div className="md-grid align-text-verticle-center no-padding">
                      <div className="app-name">
                        <b><h3>{app['appName']}</h3></b>
                      </div>
                      <Button flat onClick={() => {
                        this.props.selectApp(app)
                        this.launchApp(app['url'])
                      }}>GET</Button>
                    </div>
                    <hr />
                    <div className="md-grid no-padding">
                      <div className="md-cell--12-desktop md-cell--8-tablet md-cell--4-phone app-desc">
                        {app['description']}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )
      })
    );
  }
}

export function mapStateToProps(state) {
  return {
    apps: state.apps.apps,
  };
}

export default withRouter(connect(mapStateToProps, { fetchApps, selectApp })(Apps));
