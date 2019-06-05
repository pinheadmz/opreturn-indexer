/*!
 * txindexer.js - transaction indexer for bcoin
 * Copyright (c) 2018, the bcoin developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const bdb = require('bdb');
const bio = require('bufio');
const {consensus, TX, primitives, Indexer, Opcode} = require('bcoin');
const {TXMeta} = primitives;

const layout = require('./layout');

/*
 * Hard-coded OP_RETURN prefix filter
 * This can be extended to check a .conf file or accept a launch argument,
 * but then that filter would need to be consistent on every launch.
 * This filter is set for:
 *   `sidetree:<32-byte-hash>`
 * Which implies a Bitcoin output script of:
 *  `OP_RETURN <41 (length byte)> <9-byte sidetree prefix> <32-byte hash>`
 */

const prefix = Buffer.from('sidetree:', 'ascii');
const dataLength = Buffer.from([prefix.length + 32]);
const opreturn = Opcode.fromSymbol('OP_RETURN').toRaw();
const filter = Buffer.concat([opreturn, dataLength, prefix]);

/*
 * TXIndexer Database Layout:
 *  t[hash] -> tx record
 *  b[height] -> block record
 *  h[height][hash] -> dummy (tx hash by height)
 *
 * The transaction index maps a transaction to a block
 * and an index, offset, and length within that block. The
 * block hash is stored in a separate record by height so that
 * the 32 byte hash is not repeated for every transaction
 * within a block.
 */

Object.assign(layout, {
  t: bdb.key('t', ['hash256']),
  b: bdb.key('b', ['uint32']),
  H: bdb.key('H', ['uint32', 'hash256'])
});

/**
 * Block Record
 */

class BlockRecord {
  /**
   * Create a block record.
   * @constructor
   */

  constructor(options = {}) {
    this.block = options.block || consensus.ZERO_HASH;
    this.time = options.time || 0;

    assert(this.block.length === 32);
    assert((this.time >>> 0) === this.time);
  }

  /**
   * Inject properties from serialized data.
   * @private
   * @param {Buffer} data
   */

  fromRaw(data) {
    const br = bio.read(data);

    this.block = br.readHash();
    this.time = br.readU32();

    return this;
  }

  /**
   * Instantiate block record from serialized data.
   * @param {Hash} hash
   * @param {Buffer} data
   * @returns {BlockRecord}
   */

  static fromRaw(data) {
    return new this().fromRaw(data);
  }

  /**
   * Serialize the block record.
   * @returns {Buffer}
   */

  toRaw() {
    const bw = bio.write(36);

    bw.writeHash(this.block);
    bw.writeU32(this.time);

    return bw.render();
  }
}

/**
 * Transaction Record
 */

class TxRecord {
  /**
   * Create a transaction record.
   * @constructor
   */

  constructor(options = {}) {
    this.height = options.height || 0;
    this.index = options.index || 0;
    this.offset = options.offset || 0;
    this.length = options.length || 0;

    assert((this.height >>> 0) === this.height);
    assert((this.index >>> 0) === this.index);
    assert((this.offset >>> 0) === this.offset);
    assert((this.length >>> 0) === this.length);
  }

  /**
   * Inject properties from serialized data.
   * @private
   * @param {Buffer} data
   */

  fromRaw(data) {
    const br = bio.read(data);

    this.height = br.readU32();
    this.index = br.readU32();
    this.offset = br.readU32();
    this.length = br.readU32();

    return this;
  }

  /**
   * Instantiate transaction record from serialized data.
   * @param {Hash} hash
   * @param {Buffer} data
   * @returns {BlockRecord}
   */

  static fromRaw(data) {
    return new this().fromRaw(data);
  }

  /**
   * Serialize the transaction record.
   * @returns {Buffer}
   */

  toRaw() {
    const bw = bio.write(16);

    bw.writeU32(this.height);
    bw.writeU32(this.index);
    bw.writeU32(this.offset);
    bw.writeU32(this.length);

    return bw.render();
  }
}

/**
 * TXIndexer
 * @alias module:indexer.TXIndexer
 * @extends Indexer
 */

class OPRIndexer extends Indexer {
  /**
   * Create a indexer
   * @constructor
   * @param {Object} options
   */

  constructor(options) {
    super('opr', options);

    this.db = bdb.create(this.options);
  }

  /**
   * Index transactions by txid.
   * @private
   * @param {BlockMeta} meta
   * @param {Block} block
   * @param {CoinView} view
   */

  async indexBlock(meta, block, view) {
    const brecord = new BlockRecord({
      block: meta.hash,
      time: block.time
    });

    this.put(layout.b.encode(meta.height), brecord.toRaw());

    for (let i = 0; i < block.txs.length; i++) {
      const tx = block.txs[i];

      // Check every output of every tx in the block for the filter.
      let add = false;
      for (const output of tx.outputs) {
        const script = output.script.toRaw();

        if (!script.slice(0, filter.length).equals(filter))
          continue;

        add = true;
      }
      if (!add)
        continue;

      const hash = tx.hash();
      const {offset, size} = tx.getPosition();

      const txrecord = new TxRecord({
        height: meta.height,
        index: i,
        offset: offset,
        length: size
      });

      this.put(layout.t.encode(hash), txrecord.toRaw());
      this.put(layout.H.encode(meta.height, hash), null);
    }
  }

  /**
   * Remove transactions from index.
   * @private
   * @param {BlockMeta} meta
   * @param {Block} block
   * @param {CoinView} view
   */

  async unindexBlock(meta, block, view) {
    this.del(layout.b.encode(meta.height));

    for (let i = 0; i < block.txs.length; i++) {
      const tx = block.txs[i];
      const hash = tx.hash();
      this.del(layout.t.encode(hash));
      this.del(layout.H.encode(meta.height, hash));
    }
  }

  /**
   * Get transaction hashes within a range of blocks.
   * @param {Number} start
   * @param {Number} stop
   * @returns {Promise} - Returns Array.
   */

  async getRange(start, stop) {
    return this.db.keys({
      gte: layout.H.min(start),
      lte: layout.H.max(stop),
      parse: key => layout.H.decode(key)[1]
    });
  }

  /**
   * Get a transaction with metadata.
   * @param {Hash} hash
   * @returns {Promise} - Returns {@link TXMeta}.
   */

  async getMeta(hash) {
    const raw = await this.db.get(layout.t.encode(hash));
    if (!raw)
      return null;

    const record = TxRecord.fromRaw(raw);
    const {height, index, offset, length} = record;

    const braw = await this.db.get(layout.b.encode(height));
    if (!braw)
      return null;

    const brecord = BlockRecord.fromRaw(braw);
    const {block, time} = brecord;

    const data = await this.blocks.read(block, offset, length);

    const tx = TX.fromRaw(data);

    const meta = TXMeta.fromTX(tx);
    meta.height = height;
    meta.block = block;
    meta.time = time;
    meta.index = index;

    return meta;
  }

  /**
   * Retrieve a transaction.
   * @param {Hash} hash
   * @returns {Promise} - Returns {@link TX}.
   */

  async getTX(hash) {
    const meta = await this.getMeta(hash);

    if (!meta)
      return null;

    return meta.tx;
  }

  /**
   * @param {Hash} hash
   * @returns {Promise} - Returns Boolean.
   */

  async hasTX(hash) {
    return this.db.has(layout.t.encode(hash));
  }
}

module.exports = OPRIndexer;
