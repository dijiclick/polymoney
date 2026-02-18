import { config } from '../util/config.js';
import { createLogger } from '../util/logger.js';
import { normalize } from '../util/normalize.js';
import { processUmaProposal } from './opportunity.js';
import type { State } from '../state.js';
import type { UmaEvent } from './uma-websocket.js';

const log = createLogger('etherscan');

export function startEtherscanBackup(state: State): void {
  log.info(`Etherscan backup started (every ${config.ETHERSCAN_INTERVAL / 1000}s)`);

  setInterval(async () => {
    try {
      await pollEtherscan(state);
    } catch (e: any) {
      log.error('Etherscan poll failed', e.message);
    }
  }, config.ETHERSCAN_INTERVAL);
}

async function pollEtherscan(state: State): Promise<void> {
  // If no block cursor, get latest block and go back 1000 blocks
  let fromBlock = state.lastProcessedBlock;
  if (!fromBlock) {
    fromBlock = await getLatestBlock() - 1000;
  }

  const url = `https://api.etherscan.io/v2/api?chainid=137`
    + `&module=logs&action=getLogs`
    + `&address=${config.OOV2_ADDRESS}`
    + `&topic0=${config.TOPIC_PROPOSE}`
    + `&topic0_1_opr=and`
    + `&topic1=${config.TOPIC_UMA_ADAPTER}`
    + `&fromBlock=${fromBlock}&toBlock=latest`
    + `&page=1&offset=1000`
    + `&apikey=${config.ETHERSCAN_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    log.warn(`Etherscan API ${res.status}`);
    return;
  }

  const data = await res.json();
  if (data.status !== '1' || !data.result || !Array.isArray(data.result)) {
    // status '0' with 'No records found' is normal
    if (data.message !== 'No records found') {
      log.debug(`Etherscan: ${data.message || 'no results'}`);
    }
    return;
  }

  let newProposals = 0;
  for (const entry of data.result) {
    const blockNum = parseInt(entry.blockNumber, 16);

    // Skip already-processed blocks
    if (blockNum <= state.lastProcessedBlock) continue;

    const decoded = decodeLogData(entry.data);
    if (!decoded) continue;

    const titleNorm = normalize(decoded.title);
    const marketId = state.marketsByQuestion.get(titleNorm);

    if (marketId) {
      const event: UmaEvent = {
        type: 'propose',
        proposedPrice: decoded.proposedPrice,
        expirationTimestamp: decoded.expirationTimestamp,
        title: decoded.title,
        txHash: entry.transactionHash || '',
        blockNumber: blockNum,
      };

      log.info(`ETHERSCAN BACKUP: Proposal for "${decoded.title.slice(0, 80)}" (block ${blockNum})`);
      processUmaProposal(state, marketId, event);
      newProposals++;
    }

    state.lastProcessedBlock = Math.max(state.lastProcessedBlock, blockNum);
  }

  if (newProposals > 0) {
    log.info(`Etherscan: found ${newProposals} new proposals`);
  }
}

async function getLatestBlock(): Promise<number> {
  const url = `https://api.etherscan.io/v2/api?chainid=137&module=proxy&action=eth_blockNumber&apikey=${config.ETHERSCAN_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return parseInt(data.result, 16) || 0;
}

function decodeLogData(data: string): {
  proposedPrice: bigint;
  expirationTimestamp: number;
  title: string;
} | null {
  try {
    const hex = data.startsWith('0x') ? data.slice(2) : data;
    if (hex.length < 448) return null;

    const proposedPrice = BigInt('0x' + hex.slice(192, 256));
    const expirationTimestamp = Number(BigInt('0x' + hex.slice(256, 320)));

    const ancLen = Number(BigInt('0x' + hex.slice(384, 448)));
    if (ancLen <= 0 || ancLen > 10000) return null;

    const ancHex = hex.slice(448, 448 + ancLen * 2);
    const ancText = Buffer.from(ancHex, 'hex').toString('utf-8');

    const titleMatch = ancText.match(/title:\s*(.+?),\s*description:/);
    const title = titleMatch ? titleMatch[1].trim() : '';

    return { proposedPrice, expirationTimestamp, title };
  } catch {
    return null;
  }
}
