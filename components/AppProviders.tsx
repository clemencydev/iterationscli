"use client"

import { usePathname } from "next/navigation"
import { ThemeProvider } from "@/components/theme-provider"
import TerminalContextProvider from "@/contexts/TerminalContext/TerminalContext"
import { AuthenticateProvider } from "@/contexts/AuthenticateContext"
import FontLoader from "@/components/FontLoader"

export default function AppProviders({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  // Keep the original site theme everywhere; only the alpha skips legacy auth/commands.
  if (pathname === "/alpha")
    return (
      <ThemeProvider>
        <FontLoader />
        {children}
      </ThemeProvider>
    )
  return (
    <AuthenticateProvider>
      <ThemeProvider>
        <FontLoader />
        <TerminalContextProvider>{children}</TerminalContextProvider>
      </ThemeProvider>
    </AuthenticateProvider>
  )
}
