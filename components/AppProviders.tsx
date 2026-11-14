"use client"

import { usePathname } from "next/navigation"
import { ThemeProvider } from "@/components/theme-provider"
import TerminalContextProvider from "@/contexts/TerminalContext/TerminalContext"
import { AuthenticateProvider } from "@/contexts/AuthenticateContext"

export default function AppProviders({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  // Keep the original site theme everywhere; only the alpha skips legacy auth/commands.
  if (pathname === "/alpha") return <ThemeProvider>{children}</ThemeProvider>
  return (
    <AuthenticateProvider>
      <ThemeProvider>
        <TerminalContextProvider>{children}</TerminalContextProvider>
      </ThemeProvider>
    </AuthenticateProvider>
  )
}
