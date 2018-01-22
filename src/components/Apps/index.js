import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { fetchApps } from './apps.actions';
import {
  Button,
  Card,
  CardActions,
  CardTitle,
  FontIcon,
  Paper
} from 'react-md';

class Apps extends Component {

  componentDidMount() {
    this.props.fetchApps();
  }

  render() {
    const { apps } = this.props;

    return (
      apps.map((app, key) => {
        return (
          <div className="md-grid md-toolbar--relative">
            <div className="md-cell md-cell--3-desktop md-cell--0-tablet" />
            <div className="md-cell md-cell--6-desktop md-cell--8-tablet" style={{ color: 'white' }}>
              <div className="md-grid">
                <div className="md-cell md-cell--3-desktop md-cell--2-tablet md-cell--1-phone">
                  <FontIcon iconClassName="fa fa-rocket" style={{color: 'white', fontSize: '80px'}} />
                </div>
                <div className="md-cell md-cell--9-desktop md-cell--6-tablet md-cell--3-phone">
                  <div className="md-grid">
                    <div className="md-cell--9-desktop md-cell--6-tablet md-cell--3-phone">
                      {app['appName']}
                    </div>
                    <div className="md-cell--3-desktop md-cell--2-tablet md-cell--1-phone">
                      <Button flat style={{ float: 'right', color: 'white' }}>Launch</Button>
                    </div>
                  </div>
                  <div className="md-grid">
                    <div className="md-cell--12-desktop md-cell--8-tablet md-cell--4-phone">
                      {app['description']}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })
    );
  }
}
{/* <div>{app['appName']}</div>
  <span> <Button flat style={{ float: 'right' }}>Launch</Button> </span>
<div className="md-grid">
  <div className="md-cell md-cell--2-desktop md-cell--1-tablet md-cell--1-phone" />
  <div>
    {app['description']}
  </div>
</div> */}

export function mapStateToProps(state) {
  return {
    apps: state.apps.apps
  };
}

export default withRouter(connect(mapStateToProps, { fetchApps })(Apps));
