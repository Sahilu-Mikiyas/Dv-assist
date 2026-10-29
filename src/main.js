// Composition root: build dependencies and start the server.

import { loadConfig } from './config.js';
import { auth } from './http/auth.js';
import { createApp } from './http/server.js';
import { bitnobClient } from './infra/bitnob.js';
import { caseRepository, openDb } from './infra/db.js';
import { caseService } from './services/cases.js';

const config = loadConfig();
const cases = caseService({
  repo: caseRepository(openDb(config.dbPath)),
  bitnob: bitnobClient(config.bitnob),
  cardAmountUsd: config.cardAmountUsd,
});

createApp({ cases, authn: auth(config) }).listen(config.port, () => {
  console.log(`DV Assist listening on http://localhost:${config.port}`);
});
