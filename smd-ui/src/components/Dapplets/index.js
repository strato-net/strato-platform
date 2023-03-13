import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import ReactGA from 'react-ga4';
import { toasts } from "../Toasts";
import './Dapplets.css'

/* 
    TODO: 
        * Dapplet components should pass a prop called 'modal' (or something of the likes) which is
          the modal that controls the respective Dapplet contract and pulls user information
*/

class Dapplets extends Component {
    constructor() {
      super()
      this.state = {}
    }
    componentDidMount() {
      ReactGA.send({hitType: "pageview", page: "/dapplets", title: "dapplets"});
    }

    render() {
      return (
        <div className="container-lg pt-dark" >
            <div className="col-md-6 smd-margin-8" style={{ marginTop: '20px' }}>
                <DappletCard
                    name="Invoicing"
                    description="Send, pay, and manage your invoices"
                    iconClass="fa-envelope-o"
                />
            </div>
            <div className="col-md-6 smd-margin-8">
                <DappletCard
                    name="Multi-account Wallet"
                    description="Control and trade assets with your peers"
                    iconClass="fa-users"
                />
            </div>
            <div className="col-md-6 smd-margin-8">
                <DappletCard
                    name="Escrow"
                    description="Manage the secure transactions of your assets"
                    iconClass="fa-handshake-o"
                />
            </div>
            <div className="col-md-6 smd-margin-8">
                <DappletCard
                    name="Auction"
                    description="Bid for assets and manage your postings"
                    iconClass="fa-line-chart" />
            </div>
            <div className="col-md-6 smd-margin-8">
                <DappletCard
                    name="Asset Authenticator"
                    description="Create certificates of authenticity for your assets"
                    iconClass="fa-certificate" />
            </div>
        </div>
      );
    }

}


class DappletCard extends Component {
  constructor() {
    super()
    this.state = {
      isOpen: false,
    }
  }

  render() {
    let classes = 'pt-card pt-dark pt-elevation-2 ';
    classes += this.props.mode ? this.props.mode : 'neutral';

    return (
      <div className={classes} onClick={() => {
          toasts.show({ message: "Coming soon!" })
          ReactGA.event("click", { page_title: "dapplets", event_category: this.props.name })
        }}>
        <div className="row">
          <div className="col-xs-3 text-center">
            <i className={'fa ' + this.props.iconClass + ' fa-5x smd-pad-8'} aria-hidden="true"></i>
          </div>
          <div className="col-xs-8">
            <div className="h2 text-left">
              <strong>{this.props.name}</strong>
            </div>
            <div className="h4 text-left desc">
              {this.props.description}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default withRouter(connect()(Dapplets))
