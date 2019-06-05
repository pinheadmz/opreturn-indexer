### OP_RETURN transaction indexer for bcoin

_Note: this repo is currently configured for `sidetree` transactions_

This repository is a modified version of the
[transaction indexer in bcoin](https://github.com/bcoin-org/bcoin/blob/master/lib/indexer/txindexer.js)
that has been re-packaged as a plugin.

Read more about writing plugins for bcoin in our
[plugins guide](https://bcoin.io/guides/building-plugins.html)
or the
[example](https://github.com/bcoin-org/bcoin/blob/master/docs/examples/peers-plugin.js)
in the bcoin docs directory.


#### Usage

Install dependencies:

```
npm i
```

Launch your bcoin full node with this argument:
```
bcoin --plugins /path/to/opreturn-indexer/opri-plugin.js
```

The plugin adds two new endpoints to the Full Node's HTTP API:

`/opri/tx/:hash`

Returns the tx by its hash

`/opri/range/:start/:stop`

Returns all transactions confirmed in blocks within a specified range (inclusive).

#### Explanation

This indexer is based on the tx-indexer built into bcoin. It listens for
`'connect'` and `'disconnect'` events from `chain` and indexes or un-indexes
blocks appropriately. For this specific module, transactions are not indexed
unless they contain an OP_RETURN output whose data matches a specific filter:

```
sidetree: <32-byte-hash>
```

Transactions that match the filter are stored by their hash, and additionally
indexed by block height, so that batches of matching transactions can be
requested from the API.

#### Disclaimer

This repo is currently a proof-of-concept and should not be used in production
without review and testing.
