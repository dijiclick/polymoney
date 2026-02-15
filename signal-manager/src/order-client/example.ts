/**
 * Example: Using the Order Client
 *
 * This file demonstrates how to use the order-client module in a trading strategy.
 * The order-client handles all the low-level details:
 * - Connection warmup and keep-alive
 * - Market params caching
 * - Pre-signing orders for instant submission
 * - Racing parallel requests for fastest execution
 */

import { createOrderClient, OrderClient } from './index.js';

/**
 * Example: Initialize and use the order client
 */
async function exampleUsage(): Promise<void> {
  // 1. Get your private key (from environment or config)
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    console.log('PRIVATE_KEY not set - cannot create order client');
    return;
  }

  // 2. Get market tokens (your strategy would fetch these from Gamma API)
  const tokens = {
    yes: 'your-yes-token-id',  // Token ID for YES/UP outcome
    no: 'your-no-token-id',    // Token ID for NO/DOWN outcome
  };

  // 3. Create the order client
  // The client handles credential derivation, wallet setup, and warmup internally
  const client = await createOrderClient({
    privateKey,
    tokens,
    defaultShares: 5,  // Default shares per order
    // Optional: proxyAddress and signatureType for proxy wallets
  });

  // 4. Place orders with simple API
  try {
    // Buy 4 shares of YES at 24 cents
    const result1 = await client.buy('yes', 4, 24);
    if (result1.success) {
      console.log(`Order placed: ${result1.orderId}`);
    } else {
      console.log(`Order failed: ${result1.error}`);
    }

    // Buy 3 shares of NO at 41 cents
    const result2 = await client.buy('no', 3, 41);
    if (result2.success) {
      console.log(`Order placed: ${result2.orderId}`);
    } else {
      console.log(`Order failed: ${result2.error}`);
    }
  } finally {
    // 5. Clean up when done
    await client.stop();
  }
}

/**
 * Example: Integrating with a trading strategy
 *
 * Shows how the price-compare.ts strategy could use the order client.
 */
async function strategyIntegration(
  client: OrderClient,
  signal: { direction: 'UP' | 'DOWN'; change: number }
): Promise<void> {
  // Map UP/DOWN to yes/no
  const direction = signal.direction === 'UP' ? 'yes' : 'no';

  // Get current market price (your strategy would have this)
  const marketPriceCents = 45;  // Example: current price is 45¢

  // Calculate order price with offset
  const entryOffset = 2;  // Pay 2¢ more for faster fill
  const orderPriceCents = Math.min(99, marketPriceCents + entryOffset);

  // Place the order
  const shares = 5;
  const result = await client.buy(direction as 'yes' | 'no', shares, orderPriceCents);

  if (result.success) {
    console.log(`Trade executed: ${signal.direction} @ ${orderPriceCents}¢`);
    console.log(`Order ID: ${result.orderId}`);

    // Your strategy would then:
    // - Track the position with the order ID
    // - Query order status API after 1 second to get actual fill price
    // - Set up exit timer
    // - Monitor for exit signals
  } else {
    console.log(`Trade failed: ${result.error}`);
  }
}

// Note: To run this example, you would call:
// exampleUsage().catch(console.error);
