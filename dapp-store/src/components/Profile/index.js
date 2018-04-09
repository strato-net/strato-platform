import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Card, FontIcon } from 'react-md';
import { fetchAccountDetail } from './profile.action';
import { env } from '../../env';

import './profile.css';

class Profile extends Component {
  constructor(props) {
    super(props);
    this.state = {
      user: null
    }
  }

  componentDidMount() {
    const user = localStorage.getItem(env.USERKEY);
    if (!user) {
      this.props.history.push('/login');
    } else {
      const data = JSON.parse(user);
      this.setState({ user: data });
      this.props.fetchAccountDetail(data.address)
    }
  }

  render() {
    const { account } = this.props.profile;
    return (
      <section>
        <div className="md-grid">
          <Card className="md-block-centered content profile-box">
            <div className="md-grid">
              <h1 className="md-cell--12 md-text-center">
                User Profile
              </h1>
              <div className="md-cell--12 md-text-center">
                <FontIcon iconClassName="fa fa-user user-icon" /> 
              </div>
              <h3 className="md-cell--12 md-text-center">
                {this.state.user && this.state.user.username}
              </h3>
              <h3 className="md-cell--12 md-text-center">
                Balance: {account && account.balance ? account.balance / Math.pow(10,18) : 'Unknown'}
              </h3>
              <div className="md-cell--12 md-text-center">
                <Button raised primary onClick={() => this.props.history.goBack()}> return to dApp</Button>
              </div>
            </div>
          </Card>
        </div>
      </section>
    );
  }
}

export function mapStateToProps(state) {
  return {
    profile: state.profile,
  };
}

export default withRouter(connect(mapStateToProps, { fetchAccountDetail })(Profile));
