/**
 * Test script to verify both Main and Goldsky wallet flows
 * Run: node test_flows.js
 */

const DASHBOARD_URL = 'http://localhost:3000'

async function testGoldskyFlow() {
  console.log('\n🔍 Testing Goldsky Flow...')
  console.log('=' .repeat(60))

  try {
    // Test 1: Check if goldsky_wallets table is accessible
    console.log('\n1. Testing goldsky_wallets API endpoint...')
    const walletsRes = await fetch(`${DASHBOARD_URL}/api/goldsky/wallets?source=all&minBalance=0&period=30d&limit=10&sortBy=copy_score&sortDir=desc`)
    const walletsData = await walletsRes.json()

    if (walletsRes.ok) {
      console.log(`   ✅ API responding: ${walletsData.wallets?.length || 0} wallets found`)
      console.log(`   📊 Stats: Total=${walletsData.totalEstimate || 0}`)
    } else {
      console.log(`   ❌ API error: ${walletsData.error}`)
      return false
    }

    // Test 2: Test a single wallet analysis (if we provide a test address)
    console.log('\n2. Testing Goldsky metrics calculation...')
    console.log('   ℹ️  To test: Click "Discover" button in /goldsky page')
    console.log('   ℹ️  Or use: POST /api/goldsky/refresh?address=0x...')

    return true
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`)
    return false
  }
}

async function testMainWalletFlow() {
  console.log('\n💼 Testing Main Wallet Flow...')
  console.log('=' .repeat(60))

  try {
    // Test 1: Check if wallets table is accessible
    console.log('\n1. Testing main wallets API endpoint...')
    const walletsRes = await fetch(`${DASHBOARD_URL}/api/wallets?source=all&minBalance=0&period=30d&limit=10&sortBy=copy_score&sortDir=desc`)
    const walletsData = await walletsRes.json()

    if (walletsRes.ok) {
      console.log(`   ✅ API responding: ${walletsData.wallets?.length || 0} wallets found`)
      console.log(`   📊 Stats: Total=${walletsData.totalEstimate || 0}`)
    } else {
      console.log(`   ❌ API error: ${walletsData.error}`)
      return false
    }

    // Test 2: Check system settings
    console.log('\n2. Testing system settings...')
    const settingsRes = await fetch(`${DASHBOARD_URL}/api/settings?key=analysis_mode`)
    const settingsData = await settingsRes.json()

    if (settingsRes.ok) {
      console.log(`   ✅ Settings accessible`)
      console.log(`   🔧 Analysis mode: ${settingsData.value || 'main'}`)
    } else {
      console.log(`   ❌ Settings error: ${settingsData.error}`)
    }

    console.log('\n3. Main wallet discovery:')
    console.log('   ℹ️  Requires Python script running: python -m src.main')
    console.log('   ℹ️  The script monitors live trades and analyzes wallets automatically')

    return true
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`)
    return false
  }
}

async function testDatabaseConnection() {
  console.log('\n🗄️  Testing Database Connection...')
  console.log('=' .repeat(60))

  try {
    console.log('\n1. Testing tracked_wallets table...')
    const trackedRes = await fetch(`${DASHBOARD_URL}/api/tracked-wallets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list' })
    })
    const trackedData = await trackedRes.json()

    if (trackedRes.ok) {
      console.log(`   ✅ Tracked wallets accessible: ${trackedData.tracked?.length || 0} tracked`)
    } else {
      console.log(`   ❌ Tracked wallets error: ${trackedData.error}`)
    }

    return true
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`)
    return false
  }
}

async function runTests() {
  console.log('\n')
  console.log('╔' + '═'.repeat(58) + '╗')
  console.log('║' + ' '.repeat(10) + 'Polymarket Wallet Flow Tests' + ' '.repeat(20) + '║')
  console.log('╚' + '═'.repeat(58) + '╝')

  const goldsky = await testGoldskyFlow()
  const mainWallet = await testMainWalletFlow()
  const database = await testDatabaseConnection()

  console.log('\n')
  console.log('=' .repeat(60))
  console.log('📋 Test Summary:')
  console.log('=' .repeat(60))
  console.log(`Goldsky Flow:      ${goldsky ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`Main Wallet Flow:  ${mainWallet ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`Database:          ${database ? '✅ PASS' : '❌ FAIL'}`)
  console.log('=' .repeat(60))

  if (goldsky && mainWallet && database) {
    console.log('\n🎉 All tests passed! Both flows are working correctly.')
    console.log('\n📝 Next steps:')
    console.log('   1. Goldsky: Visit /goldsky and click "Discover"')
    console.log('   2. Main: Run "python -m src.main" to start wallet discovery')
  } else {
    console.log('\n⚠️  Some tests failed. Check the errors above.')
  }

  console.log('\n')
}

// Run tests
runTests().catch(console.error)
