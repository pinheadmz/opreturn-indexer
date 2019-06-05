/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('bsert');
const {FullNode, WalletDB, Script, MTX, TX} = require('bcoin');

// Create FullNode and add plugin.
const node = new FullNode({
  network: 'regtest',
  memory: true,
  plugins: [require('../opri-plugin.js')]
});

// Shortcut to indexer plugin in node object.
const indexer = node.plugins.oprindex;

// Create a wallet database (not integrated into node for simplicity).
const wdb = new WalletDB({
  network: 'regtest'
});

// Global variables for testing.
let wallet, tx1, data1;

// Create and broadcast a transaction with an OP_RETURN output.
// Returns the hash of the new transaction.
async function mkoprtx(data) {
  const mtx = new MTX();

  const script = Script.fromNulldata(data);
  mtx.addOutput(script, 0);

  await wallet.fund(mtx);
  await wallet.sign(mtx);

  const tx = mtx.toTX();
  const txhash = tx.hash();

  await node.sendTX(tx);
  await wdb.addTX(tx);

  return txhash;
}

// Mine a block and add it to the FUllNode chain
async function mineBlock() {
  const block = await node.miner.mineBlock();
  assert(await node.chain.add(block));
  return block;
}

describe('OP_RETURN indexer', function() {
  before(async () => {
    // Open Full Node and wallet.
    await node.open();
    await wdb.open();

    // Create a wallet and get its receive address.
    wallet = await wdb.create();
    const addr = await wallet.receiveAddress();

    // Add that address to the miner so wallet receives all coins.
    node.miner.addresses.length = 0;
    node.miner.addAddress(addr);

    // Send every block to the wallet. Normally handled by wallet plugin.
    node.chain.on('connect', async (entry, block) => {
      await wdb.addBlock(entry, block.txs);
    });

    // Generate 200 inital blocks to fund the wallet.
    for (let i = 0; i < 200; i++)
      await mineBlock();
  });

  after(async () => {
    // Cleanup.
    await wdb.close();
    await node.close();
  });

  it('should send a single OPRETURN tx with prefix', async() => {
    // Create a valid sidetree anchor transaction.
    // (prefix followed by 32 byte hash)
    const prefix = Buffer.from('sidetree:', 'ascii');
    const anchor = Buffer.alloc(32);
    data1 = Buffer.concat([prefix, anchor]);

    // Create and send the OP_RETURN tx.
    tx1 = await mkoprtx(data1);

    // Mine a block, the tx will be pulled from mempool and included.
    await mineBlock();
  });

  it('should get single OPRETURN tx from indexer', async() => {
    // Get tip height and request OP_RETURN tx hashes from that block
    const height = node.chain.tip.height;
    const hashes = await indexer.oprindex.getRange(height, height);

    // Indexer should have only returned one tx.
    // It should be the tx generated from the previous test.
    assert.strictEqual(hashes.length, 1);
    assert.bufferEqual(hashes[0], tx1);
  });

  it('should get entire tx from indexer', async() => {
    // Get tx by hash from indexer.
    const tx = await indexer.oprindex.getTX(tx1);

    assert(tx instanceof TX);

    // Slice off the OP code and length byte and jsut check the data.
    const txdata = tx.outputs[0].script.raw.slice(2);
    assert.bufferEqual(txdata, data1);
  });

  it('should get nothing from indexer in historical range', async() => {
    // Get tip height and request OP_RETURN tx hashes from that block
    const height = node.chain.tip.height;
    const hashes = await indexer.oprindex.getRange(height - 1, height - 1);

    // Indexer should return zero transactions from specified range.
    assert.strictEqual(hashes.length, 0);
  });

  it('should get multiple OPRETURN txs across 10 blocks', async() => {
    // Mine 10 empty blocks
    for (let i = 0; i < 10; i++) {
      await mineBlock();
    }

    // Record height
    const heightStart = node.chain.tip.height;

    // Mine 10 blocks with OPRETURN txs
    for (let i = 0; i < 10; i++) {
      await mkoprtx(data1);
      await mineBlock();
    }

    const heightStop = node.chain.tip.height;

    // Inclsuive, will request empty starting block plus the 10 new blocks.
    const hashes = await indexer.oprindex.getRange(heightStart, heightStop);
    assert.strictEqual(hashes.length, 10);
  });

  it('should get multiple OPRETURN txs in same block', async() => {
    // Mine 10 empty blocks
    for (let i = 0; i < 10; i++) {
      await mineBlock();
    }

    // Generate 10 OPRETURN txs
    for (let i = 0; i < 10; i++)
      await mkoprtx(data1);

    // Include all in one block
    const block = await mineBlock();
    assert.strictEqual(block.txs.length, 11);
    const height = node.chain.tip.height;

    // Inclsuive, will request empty starting block plus the 10 new blocks.
    const hashes = await indexer.oprindex.getRange(height, height);
    assert.strictEqual(hashes.length, 10);
  });

  it('should not return OPRETURN tx with bad prefix', async() => {
    // This tx has the wrong prefix, will not be indexed.
    const data = Buffer.from('OMNI');
    const hash = await mkoprtx(data);

    // The "bad" tx is definitely in this block.
    const block = await mineBlock();
    assert.strictEqual(block.txs.length, 2);
    assert.bufferEqual(block.txs[1].hash(), hash);

    // Request txs from this block from indexer.
    const height = node.chain.tip.height;
    const hashes = await indexer.oprindex.getRange(height, height);
    assert.strictEqual(hashes.length, 0);

    // Request this tx hash from indexer.
    const tx = await indexer.oprindex.getTX(hash);
    assert.strictEqual(tx, null);
  });
});
