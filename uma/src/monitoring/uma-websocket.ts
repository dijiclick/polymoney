import WebSocket from 'ws';
import { config } from '../util/config.js';
import { createLogger } from '../util/logger.js';
import { normalize } from '../util/normalize.js';
import { processUmaProposal } from './opportunity.js';
import type { State } from '../state.js';

const log = createLogger('uma-ws');

export interface UmaEvent {
  type: 'propose' | 'dispute' | 'settle';
  proposedPrice: bigint;
  expirationTimestamp: number;
  title: string;
  txHash: string;
  blockNumber: number;
  proposer?: string;
}

export function startUmaWebSocket(state: State): { close: () => void } {
  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;
  const maxReconnectDelay = 30000;
  let closed = false;

  function connect() {
    if (closed) return;

    const url = `wss://polygon-mainnet.g.alchemy.com/v2/${config.ALCHEMY_API_KEY}`;
    ws = new WebSocket(url);

    ws.on('open', () => {
      log.info('Alchemy WebSocket connected');
      reconnectDelay = 1000;

      ws!.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_subscribe',
        params: ['logs', {
          address: config.OOV2_ADDRESS,
          topics: [
            [config.TOPIC_PROPOSE, config.TOPIC_DISPUTE, config.TOPIC_SETTLE],
            config.TOPIC_UMA_ADAPTER,
          ],
        }],
      }));
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Subscription confirmation
        if (msg.id === 1 && msg.result) {
          log.info(`Subscribed to UMA events (subId: ${msg.result})`);
          return;
        }

        // Actual log event
        if (msg.method === 'eth_subscription' && msg.params?.result) {
          const logEntry = msg.params.result;
          handleLogEntry(state, logEntry);
        }
      } catch (e: any) {
        log.error('Failed to parse WS message', e.message);
      }
    });

    ws.on('close', (code) => {
      if (closed) return;
      log.warn(`WS closed (code=${code}), reconnecting in ${reconnectDelay}ms`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
    });

    ws.on('error', (err) => {
      log.error('WS error', err.message);
    });
  }

  connect();
  log.info('UMA WebSocket monitor started');

  return {
    close: () => {
      closed = true;
      ws?.close();
    },
  };
}

function handleLogEntry(state: State, logEntry: any): void {
  const topic0 = logEntry.topics?.[0];
  const txHash = logEntry.transactionHash || '';
  const blockNumber = parseInt(logEntry.blockNumber || '0', 16);

  let type: UmaEvent['type'];
  if (topic0 === config.TOPIC_PROPOSE) type = 'propose';
  else if (topic0 === config.TOPIC_DISPUTE) type = 'dispute';
  else if (topic0 === config.TOPIC_SETTLE) type = 'settle';
  else return;

  const decoded = decodeProposePriceData(logEntry.data || '');
  if (!decoded) return;

  const event: UmaEvent = {
    type,
    proposedPrice: decoded.proposedPrice,
    expirationTimestamp: decoded.expirationTimestamp,
    title: decoded.title,
    txHash,
    blockNumber,
  };

  const proposedOutcome = decoded.proposedPrice > 0n ? 'YES' : 'NO';
  log.info(`UMA ${type.toUpperCase()}: "${decoded.title.slice(0, 80)}" → ${proposedOutcome} (block ${blockNumber})`);

  // Update last processed block
  if (blockNumber > state.lastProcessedBlock) {
    state.lastProcessedBlock = blockNumber;
  }

  // Match to our markets
  const titleNorm = normalize(decoded.title);
  const marketId = state.marketsByQuestion.get(titleNorm);

  if (marketId) {
    if (type === 'propose') {
      processUmaProposal(state, marketId, event);
    } else if (type === 'dispute') {
      log.warn(`DISPUTE on matched market: "${decoded.title.slice(0, 80)}"`);
    } else if (type === 'settle') {
      log.info(`SETTLED: "${decoded.title.slice(0, 80)}"`);
    }
  } else {
    log.debug(`UMA event not matched to any market: "${decoded.title.slice(0, 60)}"`);
  }
}

function decodeProposePriceData(data: string): {
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
  } catch (e) {
    return null;
  }
}
