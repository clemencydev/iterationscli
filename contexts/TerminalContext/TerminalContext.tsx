"use client"

import { createContext, useCallback, useEffect, useState } from "react"
import type { TerminalContextValue } from "@/types/terminal"
import UserSettings from "@/components/auth/UserSettings"
import EntryTerminal from "@/components/EntryTerminal"

export const TerminalContext = createContext<TerminalContextValue>({
  history: "",
  showUserSettings: false,
  active: false,
})

export default function TerminalContextProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [terminalState, setTerminalState] = useState<TerminalContextValue>({
    active: false,
    history: "",
    showUserSettings: false,
  })
  const [history, setHistory] = useState<string[]>([])
  const changeTerminalActive = useCallback((active?: boolean) => {
    setTerminalState((prev) => ({ ...prev, active: active ?? !prev.active }))
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.altKey
      )
        return
      if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault()
        changeTerminalActive()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [changeTerminalActive])

  return (
    <TerminalContext.Provider
      value={{
        ...terminalState,
        history: history.join("\n"),
        changeTerminalActive,
      }}
    >
      {terminalState.active && (
        <EntryTerminal
          close={() => changeTerminalActive(false)}
          openSettings={() =>
            setTerminalState((prev) => ({
              ...prev,
              active: false,
              showUserSettings: true,
            }))
          }
          history={history}
          remember={(command) =>
            setHistory((prev) => [...prev, command].slice(-100))
          }
        />
      )}
      <UserSettings
        open={terminalState.showUserSettings}
        setOpen={(open) =>
          setTerminalState((prev) => ({ ...prev, showUserSettings: open }))
        }
      />
      {children}
    </TerminalContext.Provider>
  )
}
