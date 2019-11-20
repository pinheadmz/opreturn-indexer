/*
 * OPReturn Indexer plugin for bcoin
 * USAGE:
 *   bcoin --log-console=false --plugins <path/to/oprt-plugin.js>
 */

'use strict';

const EventEmitter = require('events');
const OPRIndexer = require('./lib/opreturnindexer');
const HTTP = require('./lib/http');
const plugin = exports;

class Plugin extends EventEmitter {
  constructor(node) {
    super();
    this.node = node;
    this.oprindex = new OPRIndexer({
      network: node.network,
      logger: node.logger,
      blocks: node.blocks,
      chain: node.chain,
      prune: node.config.bool('prune'),
      memory: node.memory,
      prefix: node.config.str('index-prefix', node.config.prefix)
    });

    this.http = new HTTP(this.oprindex);
  }

  async open() {
    await this.oprindex.open();
    this.http.attach('/opri', this.node.http);
  }
}

plugin.id = 'oprindex';

plugin.init = function init(node) {
  return new Plugin(node);
};
