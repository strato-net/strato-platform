import React, { Component } from 'react';
import ReactGA from "react-ga4";
import './vscode.css';

import logo from './BlockApps_Icon.png';

class VSCode extends Component {

  render() {

    // Used for google analytics, currently unused
    // const eventTrack = (category, action, label) => {
    //   // console.log("GA event:", category, ":", action, ":", label);
    //   ReactGA.event({
    //     category: category,
    //     action: action,
    //     label: label,
    //   })
    // }

    return (
      <div className="smd-vscode-button">
        <a className="smd-vscode-button-link" 
           href="http://bit.ly/MercataVSCode" 
           target="_blank" 
           rel="noopener noreferrer" 
          //  onClick={eventTrack.bind(this, "SMD", "VSCode Button Click", "STRATO for Visual Studio Code")}
        >
          <img
          src={logo}
          width="20"
          alt="Blockapps Logo"
          />
          <span className="smd-vscode-button-text">STRATO for Visual Studio Code</span>
        </a>
      </div>
    );
  }
}

export default VSCode;
