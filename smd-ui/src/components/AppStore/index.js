import React, { Component } from 'react';
import mixpanelWrapper      from '../../lib/mixpanelWrapper';
import moneyLogo            from './money.png';
import ReactGA              from 'react-ga4';
import traceCarbonLogo      from './TraceCarbon.png';
import blockAppsLogo        from './BlockAppsLogo.png';


class AppStore extends Component {
    constructor() {
      super()
      this.state = {
        selected: null,
        limit: 10,
        offset: 0,
      }
    }


    render() {
      ReactGA.send({hitType: "pageview", page: "/dashboard/appstore", title: "  Appstore"});
      const appsList = [{ 
          appName: "BlockApps Bucks", 
          urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ' ,
          description: 'Better than Money. The official stable currency of Mercata.',
          image: blockAppsLogo
        } ,  {
          appName: "Trace Carbon", 
          urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ', 
          description: 'A place to buy/trade/sell your carbon credits',
          image: traceCarbonLogo
      }, {
        appName: "TCommerce", 
        urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ', 
        description: 'Better than Ebay and Amazon combined',
        image: blockAppsLogo
      }, {
        appName: "HomePage", 
        urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ', 
        description: 'Better than Ebay and Amazon combined',
        image: oneLogo
      }
    ];

      function cardProducer(name, redirect, description, image) { return (
      // <React.Fragment key={`${name}-${name}`}>
      <div className="row col-md-6">
      <div className="card-sl">
        <div className="card-heading">
        <a href={redirect} target="_black" rel="noopener noreferrer">
          <h3>{name}</h3>
          </a>
        </div>
        <div>
          <a href={redirect} target="_black" rel="noopener noreferrer">
          <img
                onClick={() => { mixpanelWrapper.track("contact_blockapps_support_click") }}
                src={image}
                alt="Blockapps Logo"
                height="60"
                className="card-image card-button"
          />
          </a>
        </div>
        <div className="card-text" ><p> {description}</p></div>
    </div></div>    
    // </React.Fragment>
    )}

      const cards = appsList.map((obj, index) => {
        var key = index;
        return cardProducer(obj['appName'],  obj['urlToApp'], obj['description'], obj['image']);
      });


      return (
        <div className="container-fluid pt-dark">    
          <div className="row">
            <div className="col-sm-4 text-left">
              <h3>AppStore</h3>
            </div>
          </div>
          {cards}
        </div>
      );
    }

}


export default AppStore;