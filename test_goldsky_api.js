/**
 * Test Goldsky GraphQL API directly
 */

const ORDERBOOK_SUBGRAPH = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn'
const PNL_SUBGRAPH = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn'

const TEST_ADDRESS = '0x2785e7029f013fb443dba010ab971e09e783af85'

async function testGoldskyAPI() {
  console.log('Testing Goldsky GraphQL API...\n')

  // Test 1: Fetch maker trades
  console.log('1. Testing Orderbook subgraph (maker trades)...')
  const makerQuery = `
    query($user: String!, $since: BigInt!, $first: Int!, $skip: Int!) {
      orderFilledEvents(
        where: { maker: $user, timestamp_gte: $since }
        first: $first
        skip: $skip
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        timestamp
        maker
        taker
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
      }
    }
  `

  try {
    const response = await fetch(ORDERBOOK_SUBGRAPH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: makerQuery,
        variables: {
          user: TEST_ADDRESS.toLowerCase(),
          since: "0",
          first: 10,
          skip: 0
        }
      })
    })

    const data = await response.json()
    if (data.errors) {
      console.log(`   ❌ GraphQL errors:`, JSON.stringify(data.errors, null, 2))
    } else if (data.data?.orderFilledEvents) {
      console.log(`   ✅ Found ${data.data.orderFilledEvents.length} maker trades`)
      if (data.data.orderFilledEvents.length > 0) {
        console.log(`   📊 Sample:`, JSON.stringify(data.data.orderFilledEvents[0], null, 2))
      }
    } else {
      console.log(`   ⚠️  Response:`, JSON.stringify(data, null, 2))
    }
  } catch (err) {
    console.log(`   ❌ Error:`, err.message)
  }

  // Test 2: Fetch user positions
  console.log('\n2. Testing PnL subgraph (user positions)...')
  const positionsQuery = `
    query($user: String!, $first: Int!, $skip: Int!) {
      userPositions(
        where: { user: $user }
        first: $first
        skip: $skip
      ) {
        tokenId
        amount
        avgPrice
        realizedPnl
        totalBought
      }
    }
  `

  try {
    const response = await fetch(PNL_SUBGRAPH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: positionsQuery,
        variables: {
          user: TEST_ADDRESS.toLowerCase(),
          first: 10,
          skip: 0
        }
      })
    })

    const data = await response.json()
    if (data.errors) {
      console.log(`   ❌ GraphQL errors:`, JSON.stringify(data.errors, null, 2))
    } else if (data.data?.userPositions) {
      console.log(`   ✅ Found ${data.data.userPositions.length} positions`)
      if (data.data.userPositions.length > 0) {
        console.log(`   📊 Sample:`, JSON.stringify(data.data.userPositions[0], null, 2))
      }
    } else {
      console.log(`   ⚠️  Unexpected response:`, JSON.stringify(data, null, 2))
    }
  } catch (err) {
    console.log(`   ❌ Error:`, err.message)
  }
}

testGoldskyAPI().catch(console.error)
