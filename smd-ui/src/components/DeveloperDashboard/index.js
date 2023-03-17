import youtubeLogo        from './youtube.png';
import vscodeLogo         from './vscode.png';
import mixpanelWrapper      from '../../lib/mixpanelWrapper';
import React, { Component } from 'react';
import ReactGA              from 'react-ga4';
import githubLogo      from './github.png';
// import blockappsLogo       from './BlockAppsLogos_DarkBG-Horizontal.png';
import APILogo       from './apidocs.png';
import devLogo       from './devdocs.png';



class DevDash extends Component {
    constructor() {
      super()
      this.state = {
        selected: null,
        limit: 10,
        offset: 0,
      }
    }
    componentDidMount() {
      ReactGA.send({hitType: "pageview", page: "/devdash", title: "  DevDash"});
    }


    render() {
      
      const appsList = [{ 
          appName: "BlockApps Youtube", 
          urlToApp: 'https://www.youtube.com/@BlockApps ' ,
          description: 'Video walkthroughs and tutorials to help guide you through your development on STRATO Mercata.',
          image: youtubeLogo
        } ,  {
          appName: "Asset Framework Repository", 
          urlToApp: 'https://github.com/blockapps/asset-framework ', 
          description: 'Asset Framework on Github — a project generation tool for asset-based applications built on STRATO Mercata.',
          image: githubLogo
      }, 
      {
        appName: "API Docs", 
        urlToApp: 'https://docs.blockapps.net/blockapps-rest/', 
        description: 'STRATO API reference - Reference guide containing all available STRATO Mercata API endpoints to use on your development journey.',
        image: APILogo
      }, 
      {
        appName: "Developer Docs", 
        urlToApp: 'https://docs.blockapps.net/', 
        description: 'Comprehensive documentation on STRATO Mercata features, key concepts, application development, and more!',
        image: devLogo
      },
      {
        appName: "VS Code Extension", 
        urlToApp: 'https://marketplace.visualstudio.com/items?itemName=BlockApps.strato-vscode', 
        description: 'Easily interact and develop on STRATO Mercata using an Integrated Development Environment directly through VS Code.',
        image: vscodeLogo
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
                onClick={() => { 
                  ReactGA.send({hitType: "pageview", page: ("/devdash/".concat(name)).replace(/\s/g, ""), title: ("  DevDash").concat(name)});
                  ReactGA.event({
                    category: name,
                    action: 'Click on app from Developer Dashboard'
                  });
                  mixpanelWrapper.track("contact_blockapps_support_click") }}
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
              <h3>Developer Dashboard</h3>
            </div>
          </div>
          {cards}
        </div>
      );
    }

}


export default DevDash;