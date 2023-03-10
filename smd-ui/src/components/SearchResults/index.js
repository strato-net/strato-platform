import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import {
  searchQueryRequest,
} from './searchresults.actions';
import {
  fetchOauthAccounts,
} from '../Accounts/accounts.actions';
import Account from '../Account';


// import ReactGA              from 'react-ga4';


class SearchResults extends Component {
  constructor() {
    super()
    this.state = {
     searchQuery2: this.setState.searchQuery
    }
  }
  componentDidMount() {
    this.props.searchQueryRequest(this.props.searchQuery)
  }
    render() {
      console.log(this.props)
      const users = this.props.searchResults;
      const rows = [];
      const selectedAddresses = [];
      // const isModeOauth = isOauthEnabled();
      users && users.forEach(function (user, index) {
          const { userAddress, commonName, organization } = user
          let userClasseName = '';
          // if (this.state.selected === index && userAddress.length > 0) {
          //   userClasseName = ' selected';
          //   addresses.map(address =>
          //     selectedAddresses.push(<Account name={user} address={address} key={address} />)
          //   );
          // }
  
          rows.push(
            <div className="smd-margin-8" key={userAddress}>
              <div className="row">
                <div className={`pt-card pt-elevation-2 smd-pointer ${userClasseName}`} key={index} onClick={(e) => {
                  // this.setState({ selected: index });
                  // this.onUserClick(user, addresses, index);
                }}>
                  {commonName} - {organization}
                </div>
              </div>
            </div>
          );
        }.bind(this));

      const appsList = [{ 
          appName: "Mercata App Store", 
          urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ' ,
          description: 'Mercata App store is the hub to find all the apps you need on the STRATO Mercata network. Visit the page to see popular apps like Mercata Portfolio, TCommerce',
          icon: "fa fa-search"
        } ,  {
          appName: "Mercata Portfolio", 
          urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ', 
          description: 'A place to buy/trade/sell your carbon credits',
          icon: "fa fa-rocket"
      }
    ];

    const othersList = [{ 
      appName: "David", 
      urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ' ,
      description: 'Mercata App store is the hub to find all the apps you need on the STRATO Mercata network. Visit the page to see popular apps like Mercata Portfolio, TCommerce',
      icon: "fa fa-search"
    } ,  {
      appName: "Nallapu", 
      urlToApp: 'https://blockappsbucks.mercata-testnet.blockapps.net/ ', 
      description: 'A place to buy/trade/sell your carbon credits',
      icon: "fa fa-rocket"
  }
];

      function cardProducer(name, redirect, description, icon) { return (
      // <React.Fragment key={`${name}-${name}`}>
      <div className="row">
      <div className="card-search-sl">
        <div className="card-search-heading">
        <a href={redirect} target="_black" rel="noopener noreferrer">
          <h3>{name} <span className={icon}></span></h3>
          
          </a>
        </div>
        <div>
          <a href={redirect} target="_black" rel="noopener noreferrer">
          </a>
        </div>
        <div className="card-search-text" ><p> {description}</p></div>
    </div></div>    
    // </React.Fragment>
    )}

      const cards = appsList.map((obj, index) => {
        var key = index;
        return cardProducer(obj['appName'],  obj['urlToApp'], obj['description'], obj['icon']);
      });

      const otherCards = othersList.map((obj, index) => {
        var key = index;
        return cardProducer(obj['appName'],  obj['urlToApp'], obj['description'], obj['icon']);
      });


      return (
        <div className="container-fluid pt-dark">    
          <div className="row">
            <div className="col-sm-4 text-left">
              <h3>Search Results</h3>
              <h4>
              Query: {this.props.searchQuery}</h4>
          </div>
              
            </div>
            <div>

            

            
          </div>

          <div className="container-fluid pt-dark">
          <div className="row">
            <div className=" main-div">
              <div className="accounts-margin-top">
                { (rows.length === 0 && this.props.searchQuery
                  ?
                  <table>
                    <tbody>
                      <tr>
                        <td colSpan={3}>No Users with that name</td>
                      </tr>
                    </tbody>
                  </table>
                  : rows)}

                  
               {this.props.searchQuery.includes("app")?  cards: otherCards}
              </div>
            </div>
            <div className="col-sm-8 account-details">
              <div>
                {selectedAddresses.length ? selectedAddresses : null}
              </div>
            </div>
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
    accounts:    state.accounts.oauthAccounts,
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      searchQueryRequest,
      fetchOauthAccounts
    }
  )(SearchResults));