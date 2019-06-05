'use strict';

const {Server} = require('bweb');
const Validator = require('bval');

class HTTP extends Server {
  constructor(indexer) {
    super();
    this.indexer = indexer;
    this.initRouter();
  }

  initRouter() {
    this.use(this.router());

    // Get a single tx from the indexer by its hash
    this.get('/tx/:hash', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const hash = valid.brhash('hash');
      const tx = await this.indexer.getMeta(hash);

      res.json(200, tx);
    });

    // Get all txs in all blocks ina range (inclusive)
    this.get('/range/:start/:stop', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const start = valid.u32('start');
      const stop = valid.u32('stop');
      const hashes = await this.indexer.getRange(start, stop);

      res.json(200, hashes);
    });
  }
}

module.exports = HTTP;
