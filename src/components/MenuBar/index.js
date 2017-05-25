import React, { Component } from 'react';
import {decorator as reduxBurgerMenu} from 'redux-burger-menu';
import { push as Menu } from 'react-burger-menu'
import './sidebar.css';
import { NavLink } from 'react-router-dom';

class MenuBar extends Component {

  navLinksData = this.props.navLinksData;

  render() {
    return (
        <nav className="pt-navbar pt-dark">
            <div className="pt-navbar-group pt-align-left">
                {/* //FIXME Fix sandwich menu needs to go into nav bar*/}
                <div id="outer-container">
                    <span className="pt-icon-standard pt-icon-menu"/>
                    {/*<Menu pageWrapId={ "page-wrap" } outerContainerId={ "outer-container" }>*/}
                        {/*{*/}
                            {/*this.navLinksData.map(*/}
                                {/*data =>*/}
                                    {/*<NavLink key={data.id} id={data.id} className="menu-item" to={data.path}>{data.label}</NavLink>*/}
                            {/*)*/}
                        {/*}*/}
                    {/*</Menu>*/}
                </div>
            </div>
            <div className="pt-navbar-group pt-align-left">
                <div className="pt-navbar-heading">Strato Management Dashboard</div>
            </div>
            <div className="pt-navbar-group pt-align-right">
                <a href="/" className="pt-button pt-minimal pt-icon-home">Home</a>
                <a href="/accounts" className="pt-button pt-minimal pt-icon-document">Accounts</a>
                <span className="pt-navbar-divider" />
                <a className="pt-button pt-minimal pt-icon-user" />
                <a className="pt-button pt-minimal pt-icon-notifications" />
                <a className="pt-button pt-minimal pt-icon-cog" />
            </div>
        </nav>
    );
  }
}

export default reduxBurgerMenu(Menubar);
