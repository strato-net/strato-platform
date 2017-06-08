import React, {Component} from 'react';
import BlockTable from './components/BlockTable';

class Blocks extends Component {
  render() {
    return(
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-3">
            <h3>Blocks</h3>
          </div>
        </div>
        <BlockTable/>
      </div>
    );
  }
}

export default Blocks;
