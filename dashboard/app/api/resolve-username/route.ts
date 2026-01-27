import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get('username')

  if (!username) {
    return NextResponse.json({ error: 'Username required' }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(username)}&search_profiles=true&limit_per_type=5`
    )

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to search profiles' }, { status: 502 })
    }

    const data = await res.json()
    const profiles = data.profiles || []

    // Find exact match (case-insensitive)
    const match = profiles.find(
      (p: any) => p.name?.toLowerCase() === username.toLowerCase()
    )

    if (match?.proxyWallet) {
      return NextResponse.json({ address: match.proxyWallet })
    }

    // If no exact match, return first result if available
    if (profiles.length > 0 && profiles[0].proxyWallet) {
      return NextResponse.json({ address: profiles[0].proxyWallet })
    }

    return NextResponse.json({ error: 'Username not found' }, { status: 404 })
  } catch (error) {
    console.error('Error resolving username:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
