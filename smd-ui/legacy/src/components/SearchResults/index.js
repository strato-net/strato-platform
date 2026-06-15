import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import {
  searchQueryRequest,
} from './searchresults.actions';

class SearchResults extends Component {
  componentDidMount() {
    this.props.searchQueryRequest(this.props.searchQuery)
  }
  render() {
    const users = this.props.searchResults;
    const rows = [];
    users && users.forEach(function (user, index) {
      const { userAddress, commonName, organization } = user
      let userClasseName = '';
      rows.push(
        <div key={userAddress}>
          <div className="row  card-search-sl">
            <div className={`card-search-text ${userClasseName}`} key={index} onClick={(e) => {
            }}>
              <h3><span className={"pt-icon-standard pt-icon-user"} style={{ marginRight: "8px", fontSize: "35px" }}></span> {commonName} </h3>
              <div><p> Organization: {organization}<br></br> User Address: {userAddress} </p></div>
            </div>
          </div>
        </div>
      );
    }.bind(this));

    const appsList = [{
      appName: "BlockApps Bucks",
      urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ',
      description: 'STRATO Mercata is home to a wide range of applications to help you complete your business faster, easier, and more securely. Transact with trusted partners for all of your business needs with real, fiat currency - no speculation and no gimmicks. Start using STRATO Mercata with one of the apps below.',
      icon: "fa fa-window-restore"
    },
      , {
      appName: "TraceCarbon",
      urlToApp: 'https://blockapps.net/apps/?utm_source=SMD&utm_medium=appstore&utm_campaign=tracecarbon#tracecarbon/ ',
      description: "TraceCarbon is a comprehensive and versatile traceable commerce d'app, aimed at accelerating the world's journey towards carbon neutrality by providing transparency to the Voluntary Carbon Markets, allowing corporate and individual buyers to explore and transact on high quality carbon credits in order to offset their emissions.",
      icon: "fa fa-window-restore"
    }
      , {
      appName: "VeriFactor",
      urlToApp: 'https://blockapps.net/apps/?utm_source=SMD&utm_medium=appstore&utm_campaign=verifactor#verifactor ',
      description: "VeriFactor is a receivables financing platform that brings end-to-end automation to a previously manual funding ecosystem. SMBs on the VeriFactor platform have access to a rich selection of flexible working capital solutions at cost-effective rates. Lenders on VeriFactor experience higher yields and lower administrative costs thanks to our technology-driven loan origination processes.",
      icon: "fa fa-window-restore"
    }
    ];

    function cardProducer(name, redirect, description, icon) {
      return (
        <div className="row card-search-sl" >
          <div className="card-search-heading">
            <a href={redirect} target="_black" rel="noopener noreferrer">
              <h3><span className={icon} style={{ marginRight: "8px" }}></span> {name} </h3>

            </a>
          </div>
          <div>
            <a href={redirect} target="_black" rel="noopener noreferrer">
            </a>
          </div>
          <div className="card-search-text" ><p> {description}</p></div>
        </div>
      )
    }

    const cards = appsList.map((obj, index) => {
      var key = index;
      return cardProducer(obj['appName'], obj['urlToApp'], obj['description'], obj['icon']);
    });
    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-12 text-left">
            <h3>Search Results</h3>
            <hr></hr>
            <h4 style={{ marginTop: "5px" }}>
              Query:<i> "{this.props.searchQuery}"</i></h4>

          </div>

        </div>
        <div>
        </div>
        <div className="container-fluid pt-dark">
          <div className="row">
            {this.props.searchQuery.includes("app") ? cards :
              this.props.searchQuery.includes("verifactor") ?
                cardProducer(appsList[3]['appName'], appsList[3]['urlToApp'], appsList[3]['description'], appsList[3]['icon']) :
                this.props.searchQuery.includes("carbon") ?
                  cardProducer(appsList[2]['appName'], appsList[2]['urlToApp'], appsList[2]['description'], appsList[2]['icon']) :
                  (this.props.searchQuery.includes("buck") || this.props.searchQuery.includes("pay")) ?
                    cardProducer(appsList[0]['appName'], appsList[0]['urlToApp'], appsList[0]['description'], appsList[0]['icon']) :(
                    <div >
                      {(rows.length === 0 && this.props.searchQuery
                        ?
                        <div>
                          <table className="card-search-sl">
                            <tbody>
                              <tr>
                                <td colSpan={3}>No Results</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        : rows)
                      }
                    </div>)}

          </div>
        </div>
      </div>
    );
  }

}

export function mapStateToProps(state) {
  return {
    searchQuery: state.search.searchQuery,
    searchResults: state.search.searchResults,
    accounts: state.accounts.oauthAccounts,
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      searchQueryRequest
    }
  )(SearchResults));