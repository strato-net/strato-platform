import blockAppsLogo        from './BlockAppsLogos_DarkBG-Horizontal.png';
// import collectXLogo         from './collectX.png';
import mixpanelWrapper      from '../../lib/mixpanelWrapper';
import React, { Component } from 'react';
import ReactGA              from 'react-ga4';
import traceCarbonLogo      from './TraceCarbon.png';
import veriFactorLogo       from './vveriFactorLogo.png';



class AppStore extends Component {
    constructor() {
      super()
      this.state = {
        selected: null,
        limit: 10,
        offset: 0,
      }
    }
    componentDidMount() {
      ReactGA.send({hitType: "pageview", page: "/appstore", title: "Appstore"});
    }


    render() {
      
      const appsList = [{ 
          appName: "BlockApps Bucks", 
          urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ' ,
          description: 'BlockApps Bucks is the STRATO Mercata loyalty program. Please contact BlockApps Support to get started using BlockApps Bucks or for more information.',
          image: blockAppsLogo
        } ,  {
          appName: "TraceCarbon", 
          urlToApp: 'https://blockapps.net/apps/?utm_source=SMD&utm_medium=appstore&utm_campaign=tracecarbon#tracecarbon/ ', 
          description: 'TraceCarbon is a carbon credit traceability and transaction network that drives innovation, confidence and scale in voluntary carbon markets. Accelerating the world’s journey to net-zero, TraceCarbon eliminates market barriers for project developers, strengthens data on credit quality, and delivers transparency and automation in carbon credit issuance, ownership transfer and retirement.',
          image: traceCarbonLogo
      }, 
      // {
      //   appName: "CollectX", 
      //   urlToApp: 'https://blockapps.net/apps/?utm_source=SMD&utm_medium=appstore&utm_campaign=collectx#collectx', 
      //   description: 'CollectX is a blockchain-powered collectibles platform. The short-term goal is to sell authenticated/graded sports cards in a simple and transparent manner. CollectX allows buyers to not worry about shipping costs. CollectX aims to ensure the original seller receives a royalty every time the product is resold. CollectX improves collectible traceability over time and gives the creator/original seller access to the secondary market.',
      //   image: collectXLogo
      // }, 
      {
        appName: "VeriFactor", 
        urlToApp: 'https://blockapps.net/apps/?utm_source=SMD&utm_medium=appstore&utm_campaign=verifactor#verifactor', 
        description: 'VeriFactor is a receivables financing platform that brings end-to-end automation to a previously manual funding ecosystem. SMBs on the VeriFactor platform have access to a rich selection of flexible working capital solutions at cost-effective rates. Lenders on VeriFactor experience higher yields and lower administrative costs thanks to our technology-driven loan origination processes.',
        image: veriFactorLogo
      }
    ];

      function cardProducer(name, redirect, description, image) { return (
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
                src={image}
                alt="Blockapps Logo"
                height="60"
                className="card-image card-button"
          />
          </a>
        </div>
        <div className="card-text" ><p> {description}</p></div>
    </div></div>    
    )}

      const cards = appsList.map((obj, index) => {
        var key = index;
        return cardProducer(obj['appName'],  obj['urlToApp'], obj['description'], obj['image']);
      });


      return (
        <div className="container-fluid pt-dark">    
          <div className="row">
            <div className="col-sm-4 text-left">
              <h3>STRATO Mercata Apps</h3>
            </div>
          </div>
          {cards}
        </div>
      );
    }

}


export default AppStore;