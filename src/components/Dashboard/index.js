import React, { Component } from 'react';
import { withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import { NavLink } from 'react-router-dom';
import { BottomNavigation, FontIcon } from 'react-md';
import { Button, DialogContainer, NavigationDrawer, SVGIcon } from 'react-md';
// import menu from 'icons/menu.svg';
// import arrowBack from 'icons/arrow_back.svg';

const links = [{
  label: 'My Dapps',
  icon: <FontIcon iconClassName="fa fa-th-large" />,
}, {
  label: 'Dapps Store',
  icon: <FontIcon iconClassName="fa fa-rocket" />,
}, {
  label: 'Updates',
  icon: <FontIcon iconClassName="fa fa-download" />,
}, {
  label: 'Search',
  icon: <FontIcon iconClassName="fa fa-search" />,
}];

class Dashboard extends Component {

  navigate() {
    this.props.history.push('/login');
  }

  render() {
    const { welcome } = this.props;

    return (
      <div>
        <div>
          <NavigationDrawer
            navItems={['red']}
            mobileDrawerType={NavigationDrawer.DrawerTypes.TEMPORARY}
            tabletDrawerType={NavigationDrawer.DrawerTypes.PERSISTENT}
            desktopDrawerType={NavigationDrawer.DrawerTypes.PERSISTENT}
            toolbarTitle="Hello, World!"
            toolbarActions={<Button icon onClick={this.navigate.bind(this)}><FontIcon iconClassName="fa fa-user-circle" /></Button>}
            persistentIcon={<FontIcon>menu</FontIcon>}
            contentId="main-demo-content"
          >
            <h1> Dashboard </h1>

          </NavigationDrawer>
        </div>
        <BottomNavigation links={links} dynamic={false} />
      </div>
    );
  }
}

export default Dashboard;
