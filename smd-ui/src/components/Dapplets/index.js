import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import ReactGA from 'react-ga4';
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
        <div className="container-lg pt-dark">
            <div className="row">
                <div className="col-sm-4 text-left">
                    <h3>Dapplets</h3>
                </div>
            </div>
            <div className="col-sm-3">
                <DappletCard
                    name="Invoicing"
                    description="Coming soon"
                    iconClass="fa-envelope-o"
                />
            </div>
            <div className="col-sm-3">
                <DappletCard
                    name="Vault"
                    description="Coming soon"
                    iconClass="fa-unlock-alt"
                />
            </div>
            <div className="col-sm-3">
                <DappletCard
                    name="Escrow"
                    description="Coming soon"
                    iconClass="fa-handshake-o"
                />
            </div>
            <div className="col-sm-3">
                <DappletCard
                    name="Auction"
                    description="Coming soon"
                    iconClass="fa-line-chart" />
            </div>
        </div>
      );
    }

}


class DappletCard extends Component {
  render() {
    let classes = 'pt-card pt-dark pt-elevation-2 ';
    classes += this.props.mode ? this.props.mode : 'neutral';

    return (
      <div className={classes} onClick={() => alert('hiiiiiiiiii')}>
        <div className="row">
          <div className="col-xs-4 text-center">
            <i className={'fa ' + this.props.iconClass + ' fa-5x smd-pad-8'} aria-hidden="true"></i>
          </div>
          <div className="col-xs-8">
            <div className="h2 text-right">
              <strong>{this.props.name}</strong>
            </div>
            <div className="h4 text-right desc">
              {this.props.description}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default withRouter(connect()(Dapplets))
