import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { FontIcon, Button, Toolbar } from 'react-md';
import DAppsStore from '../DAppsStore/index';
import Apps from '../Apps';
import Updates from '../Updates/index';
import Search from '../Search/index';
import { env } from '../../env';
import './dashboard.css';

const links = [{
  label: 'DApps',
  icon: <FontIcon iconClassName="fa fa-th-large" />,
  style: { color: 'white' }
},
  // {
  //   label: 'Dapps Store',
  //   icon: <FontIcon iconClassName="fa fa-rocket" />,
  //   style: { color: 'white' }
  // }, {
  //   label: 'Updates',
  //   icon: <FontIcon iconClassName="fa fa-download" />,
  //   style: { color: 'white' }
  // }, {
  //   label: 'Search',
  //   icon: <FontIcon iconClassName="fa fa-search" />,
  //   style: { color: 'white' }
  // }
];


class Dashboard extends Component {
  state = { title: links[0].label, children: <Apps /> };

  handleNavChange = (activeIndex) => {
    const title = links[activeIndex].label;
    let children;
    switch (activeIndex) {
      case 1:
        children = <DAppsStore key="favorites" />;
        break;
      case 2:
        children = <Updates key="nearby" />;
        break;
      case 3:
        children = <Search key="nearby" />;
        break;
      default:
        children = <Apps key="apps" />;
    }

    this.setState({ title, children });
  };

  navigate(path) {
    let { history } = this.props;
    history.push(path);
  }

  checkAuth() {
    const user = localStorage.getItem(env.USERKEY)
    const data = JSON.parse(user)

    return data && data.username;
  }

  render() {
    const { children } = this.state;
    return (
      <div>
        <Toolbar
          colored
          title="DApps"
          actions={
            <div>
              <Button raised onClick={() => this.navigate(`${window.location.protocol}//${window.location.hostname}/apps?developer`)} className="developers-button">For Developers</Button>
              <Button icon onClick={() => this.navigate('/profile')}><FontIcon iconClassName="fa fa-user-circle" /></Button>
            </div>
          }
        />
        <div>
          {children}
        </div>
        {/* <BottomNavigation
          links={links}
          dynamic={false}
          onNavChange={this.handleNavChange}
        /> */}
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    apps: state.apps,
  };
}

export default withRouter(connect(mapStateToProps, null)(Dashboard));
