import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import ThemeProvider from '@/components/ThemeProvider'
import ThemeToggle from '@/components/ThemeToggle'
import ServerStatusButton from '@/components/ServerStatusButton'
import MobileNav from '@/components/MobileNav'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Polymoney',
  description: 'Advanced wallet analytics for Polymarket traders',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} min-h-screen antialiased`}>
        <ThemeProvider>
          {/* Navigation */}
          <nav className="sticky top-0 z-50 backdrop-blur-xl" style={{ background: 'var(--bg-nav)', borderBottom: '1px solid var(--border-nav)' }}>
            <div className="max-w-[1600px] mx-auto px-3 md:px-6">
              <div className="flex items-center justify-between h-14">
                <div className="flex items-center gap-4 md:gap-8">
                  <Link href="/wallets" className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                      <svg className="w-[18px] h-[18px]" viewBox="0 0 32 32" fill="none">
                        <path d="M9 22V10.5C9 9.67 9.67 9 10.5 9H14c2.5 0 4.5 1.8 4.5 4.2 0 2.4-2 4.3-4.5 4.3H12.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <circle cx="21" cy="19" r="3.5" stroke="white" strokeWidth="2" fill="none"/>
                        <line x1="21" y1="16.5" x2="21" y2="21.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                        <line x1="18.5" y1="19" x2="23.5" y2="19" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <span className="text-lg font-semibold gradient-text">
                      Polymoney
                    </span>
                  </Link>

                  <div className="hidden md:flex items-center gap-1">
                    <Link
                      href="/wallets"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      Wallets
                    </Link>

                    <Link
                      href="/track"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                      </svg>
                      Track
                    </Link>

                    <Link
                      href="/live"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Live Feed
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        LIVE
                      </span>
                    </Link>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <div className="hidden md:flex items-center gap-1">
                    <ServerStatusButton />
                    <ThemeToggle />
                  </div>
                  <MobileNav />
                </div>
              </div>
            </div>
          </nav>

          {/* Main content */}
          <main className="max-w-[1600px] mx-auto px-3 md:px-6 py-3 md:py-6">
            {children}
          </main>

          {/* Footer */}
          <footer className="py-4 text-center">
            <p className="text-[11px] text-gray-500">
              Developed by <span className="text-gray-400 font-medium">Aria</span> &middot; 2026
            </p>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  )
}
