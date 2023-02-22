import React, { Component } from 'react';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import moneyLogo from './money.png';
import ReactGA from "react-ga4";
// import Tour from '../Tour';
// import { connect } from 'react-redux';
// import { withRouter } from 'react-router-dom';
// import { Button, Tab2, Tabs2, Popover, Position, Icon} from '@blueprintjs/core';
// import { useHistory } from 'react-router-dom';



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
      
      const appsList = [{ 
          appName: "BlockApps Bucks", 
          urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ' ,
          description: 'A place to store your money',
          image: moneyLogo
        } ,  {
          appName: "Trace Carbon", 
          urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ', 
          description: 'A place to buy your carbon credits',
          image: moneyLogo
      }, {
        appName: "TCommerce", 
        urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ', 
        description: 'Better than Ebay and Amazon combined',
        image: moneyLogo
      }, {
        appName: "HomePage", 
        urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ', 
        description: 'Better than Ebay and Amazon combined',
        image: moneyLogo
      }
    ];

      function cardProducer(name, redirect, description, image) { return (
      // <React.Fragment key={`${name}-${name}`}>
      <div className="row pt-card">
        <div className="col-sm-4 font-weight-bold">
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
                className="col-md-2"
          />
          </a>
        </div>
        <div className="text-right" ><p> {description}</p></div>
    </div>
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