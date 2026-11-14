export type EntryCommand =
  | "login"
  | "register"
  | "workspace"
  | "dashboard"
  | "logout"
  | "settings"
  | "help"
  | "clear"
  | "exit"
  | "menu"
export const ENTRY_COMMANDS: {
  command: EntryCommand
  title: string
  description: string
  signedIn?: boolean
}[] = [
  {
    command: "login",
    title: "Sign in",
    description: "Continue with your account",
  },
  {
    command: "register",
    title: "Create an account",
    description: "Set up your Iterations account",
  },
  {
    command: "workspace",
    title: "Open alpha workspace",
    description: "Try the local workspace without signing in",
  },
  {
    command: "dashboard",
    title: "Open dashboard",
    description: "Open your account's board",
    signedIn: true,
  },
  {
    command: "settings",
    title: "Account settings",
    description: "Manage your account",
    signedIn: true,
  },
  {
    command: "logout",
    title: "Sign out",
    description: "End your account session",
    signedIn: true,
  },
  {
    command: "help",
    title: "Command reference",
    description: "See commands and keyboard shortcuts",
  },
]
export function parseEntryCommand(input: string): EntryCommand | null {
  const aliases: Record<string, EntryCommand> = {
    login: "login",
    signin: "login",
    "sign in": "login",
    "auth login": "login",
    register: "register",
    signup: "register",
    "sign up": "register",
    "auth register": "register",
    workspace: "workspace",
    dashboard: "dashboard",
    settings: "settings",
    "auth settings": "settings",
    logout: "logout",
    "auth logout": "logout",
    help: "help",
    clear: "clear",
    cls: "clear",
    exit: "exit",
    menu: "menu",
  }
  const key = input.trim().toLowerCase().replace(/\s+/g, " ")
  return Object.hasOwn(aliases, key) ? aliases[key] : null
}
