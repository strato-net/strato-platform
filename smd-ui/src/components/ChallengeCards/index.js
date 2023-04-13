import React, { Component } from 'react';
import { Link} from "react-router-dom";
import ReactGA              from 'react-ga4';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './ChallengeCards.css';
import week1       from './1.png';
import week2       from './2.png';
import week3       from './3.png';
import week4       from './4.png';

class ChallengeCards extends Component {

  componentDidMount() {
    ReactGA.send({hitType: "pageview", page: "/challenge_cards", title: "Challenge Cards"});
  }

  render() {
    
    const challengeList = [
      { 
        // title: "Challenge Card 1",
        heading: "Sample Contracts",
        url: '/contracts/ ' ,
        content: "Create a smart contract on STRATO Mercata.\n\n If you're new to the platform, you can use one of the Sample Contracts to get started. Simply navigate to the contracts tab, and choose from one of the pre-populated sample contracts available.\n\n\n\n\n",
        image: week1,
        week_number: 'w1'
      },
      {
        // title: "Challenge Card 2",
        heading: "Shard Creation", 
        url: '/shards/', 
        content: "Create a private shard (aka private chain) on STRATO Mercata!\n\nPrivate shards are like secret rooms within the blockchain, where only you and your chosen members can see and manage the data. You can use private shards to create custom applications, manage sensitive information, and collaborate securely with your team.\n\nCreate Shard > Choose contract & give details > Add Member > Create Shard",
        image: week2,
        week_number: 'w2'
      }, 
      {
        // title: "Challenge Card 3",
        heading: "Voting System", 
        url: '/code_editor/', 
        content: "Create a Voting System on STRATO Mercata!\n\nContract Editor tab > Write Contract > Compile using SolidVM > Create Contract\n\nName The Contract: Challenge_Voting\n\n\n\n",
        image: week3,
        week_number: 'w3'
      },
      {
        // title: "Challenge Card 4",
        heading: "Lottery System", 
        url: '/code_editor/', 
        content: "Create a Lottery System on STRATO Mercata!\n\nContract Editor tab > Write Contract > Compile > Create Contract\n\nName The Contract: Challenge_Lottery\n\n\n\n\n",
        image: week4,
        week_number: 'w4'
      }, 
    ];
    

    function populateChallenges(heading, content, url, image, week_number, key)
    {
      return(
        <div id="inner2" className="row col-md-6 card" key={key}>
		<div className="card-front" style={{height:'80%'}}>
    <img
        alt="challenge-logos"     
        src={image}
        height="100%"
        width="100%"
            />
		</div>
		<div className="card-back" style={{height:'80%'}}>
			<p className="title">{heading}</p>
			<p className="desc">{content}</p>
      <Link 
            to={url} 
            className="desc"
            onClick={() => { 
              ReactGA.send({hitType: "pageview", page: ("/challenge_cards/".concat(week_number)), title: (heading)});
              ReactGA.event({
                category: heading,
                action: 'Click on the challenge from Challenge Cards Tab'
              });
            mixpanelWrapper.track("challenge_card_click") 
            }}> 
            
            Get Started 
        
        </Link>
		</div>
    <p/>
	</div>
      );
    } 

    const cards = challengeList.map((obj, index) => {
      var key = index;
      return populateChallenges( obj['heading'], obj['content'], obj['url'], obj['image'], obj['week_number'], key);
    });


    return (
      <div className="container-fluid pt-dark" >    
        <div className="col-sm-4 text-left">
            <h3>Challenge Cards</h3>
          </div>
        <div className="row" style={{paddingTop:'250px'}}/>
        {cards}
      </div>
    );
  }
}

export default ChallengeCards;