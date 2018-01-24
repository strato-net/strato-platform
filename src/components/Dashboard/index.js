import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { BottomNavigation, FontIcon } from 'react-md';
import { Button, NavigationDrawer } from 'react-md';
import DAppsStore from '../DAppsStore/index';
import Apps from '../Apps';
import Updates from '../Updates/index';
import Search from '../Search/index';

const links = [{
  label: 'My Dapps',
  icon: <FontIcon iconClassName="fa fa-th-large" />,
  style: { color: 'white' }
}, {
  label: 'Dapps Store',
  icon: <FontIcon iconClassName="fa fa-rocket" />,
  style: { color: 'white' }
}, {
  label: 'Updates',
  icon: <FontIcon iconClassName="fa fa-download" />,
  style: { color: 'white' }
}, {
  label: 'Search',
  icon: <FontIcon iconClassName="fa fa-search" />,
  style: { color: 'white' }
}];


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
        children = <Apps key="recent" />;
    }

    this.setState({ title, children });
  };

  navigate() {
    const user = localStorage.getItem('user')
    const data = JSON.parse(user)

    let { history } = this.props;
    data && data.username ? history.push('/profile') : history.push('/login');
  }

  render() {
    const { children } = this.state;

    return (
      <div>
        <div>
          <NavigationDrawer
            mobileDrawerType={NavigationDrawer.DrawerTypes.TEMPORARY}
            tabletDrawerType={NavigationDrawer.DrawerTypes.PERSISTENT}
            desktopDrawerType={NavigationDrawer.DrawerTypes.PERSISTENT}
            toolbarTitle="Dapps"
            toolbarActions={<Button icon onClick={this.navigate.bind(this)}><FontIcon iconClassName="fa fa-user-circle" /></Button>}
            persistentIcon={<FontIcon>menu</FontIcon>}
            contentId="main-demo-content"
          >
            {children}
          </NavigationDrawer>
        </div>
        <BottomNavigation
          links={links}
          dynamic={false}
          onNavChange={this.handleNavChange}
        />
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
