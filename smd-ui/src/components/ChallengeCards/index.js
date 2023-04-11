import React, { Component } from 'react';
import { Link} from "react-router-dom";
import './ChallengeCards.css';
import week1       from './c1.png';
import week2       from './c2.png';
import week3       from './c3.png';

class ChallengeCards extends Component {


  render() {
    
    const challengeList = [
      { 
        // title: "Challenge Card 1",
        heading: "Sample Contracts",
        url: '/contracts/ ' ,
        content: "Create a smart contract on STRATO Mercata.\n\n If you're new to the platform, you can use one of the Sample Contracts to get started. Simply navigate to the contracts tab, and choose from one of the pre-populated sample contracts available.\n\n\n\n\n",
        image: week1
      },
      {
        // title: "Challenge Card 2",
        heading: "Shard Creation", 
        url: '/shards/', 
        content: "Create a private shard (aka private chain) on STRATO Mercata!\n\nPrivate shards are like secret rooms within the blockchain, where only you and your chosen members can see and manage the data. You can use private shards to create custom applications, manage sensitive information, and collaborate securely with your team.\n\nCreate Shard > Choose contract & give details > Add Member > Create Shard",
        image: week2
      }, 
      {
        // title: "Challenge Card 3",
        heading: "Voting System", 
        url: '/code_editor/', 
        content: "Create a Voting System on STRATO Mercata!\n\nContract Editor tab > Write Contract > Compile using SolidVM > Create Contract\n\nName The Contract: Challenge_Voting\n\n\n\n",
        image: week3
      }, 
    ];
    

    function populateChallenges(heading, content, url, image, key)
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
      <Link to={url} className="desc"> Get Started </Link>
		</div>
    <p/>
	</div>
      );
    } 

    const cards = challengeList.map((obj, index) => {
      var key = index;
      return populateChallenges( obj['heading'], obj['content'], obj['url'], obj['image'], key);
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