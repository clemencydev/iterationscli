import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { LoginHandler, LogoutHandler, RegisterHandler, SettingHandler } from "./handlers/auth/handlers";
import { TerminalContextValue } from "@/types/terminal";
import { Dispatch, SetStateAction } from "react";

export type CommandName =
  | "workspace"
  | "help"
  | "auth"
// | "settings"

export type CommandArguement = {
  name: string;
  descriprion: string;
  /** Fixed choices offered by tab-completion. */
  values?: string[];
  /** Live list offered by tab-completion (task, column, label, checkpoint, proposal). */
  source?: string;
}

export type CommandHandlerProps = { terminalState: TerminalContextValue, setTerminalState:  Dispatch<SetStateAction<TerminalContextValue>>, router?: AppRouterInstance, checkSession?: () => void };
export type CommandHandler = (props: CommandHandlerProps) => void;

export type Command = {
  name: string;
  usage: string;
  auth_required: boolean;
  icon?: string;
  handler?: CommandHandler,
  args?: CommandArguement[];
  sub_commands?: Record<string, Command>;
}

export const Commands: Record<CommandName, Command> = {
  workspace: {
    name: "workspace",
    usage: "Open the alpha workspace",
    auth_required: false,
    handler: ({ router, setTerminalState }) => {
      setTerminalState(prev => ({ ...prev, active: false }));
      router?.push("/alpha");
    },
  },
  auth: {
    name: "auth",
    usage: "Used for sign-up/sign-in/sign-out of user accounts",
    auth_required: false, 
    sub_commands: {
      register: {
        name: "register",
        usage: "Used for creating an account",
        auth_required: false, 
        args: [{ name: "username", descriprion: "<value>" }, { name: "password", descriprion: "<password>" }],
        handler: RegisterHandler
      },
      login: {
        name: "login",
        usage: "Used for logging into an account",
        auth_required: false, 
        args: [{ name: "username", descriprion: "<value>" }, { name: "password", descriprion: "<password>" }],
        handler: LoginHandler
      },
      logout: {
        name: "logout",
        usage: "Used for logging out of an account",
        auth_required: false, 
        handler: LogoutHandler
      },
      settings: {
        name: "settings",
        usage: "Used for changing account information",
        auth_required: true, 
        handler: SettingHandler
      }
    }
  },
  help: {
    name: "help",
    usage: "Lists the usage associated with a command",
    auth_required: false, 
  },
}

// The alpha workspace terminal (lib/alpha.ts `execute`) described in the same
// shape, so lib/completion.ts can complete commands, subcommands and arguments.
const VIEW_NAMES = ["terminal", "board", "canvas", "stats", "inbox", "history", "settings"];
const text = (name: string): CommandArguement => ({ name, descriprion: `"${name}"` });
const task: CommandArguement = { name: "task-id", descriprion: "<task-id>", source: "task" };
const column: CommandArguement = { name: "column", descriprion: '"Column"', source: "column" };
const label: CommandArguement = { name: "label", descriprion: '"Label"', source: "label" };
const local = (name: string, usage: string, args?: CommandArguement[]): Command =>
  ({ name, usage, auth_required: false, args });
const group = (name: string, usage: string, commands: Command[]): Command => ({
  name,
  usage,
  auth_required: false,
  sub_commands: Object.fromEntries(commands.map((c) => [c.name, c])),
});

export const WorkspaceCommands: Record<string, Command> = {
  task: group("task", "Create and manage tasks", [
    local("new", "Create a task", [text("title")]),
    local("list", "List every task"),
    local("done", "Mark a task complete", [task]),
    local("reopen", "Reopen a completed task", [task]),
    local("move", "Move a task to a column", [task, column]),
    local("submit", "Mark a task submitted", [task]),
    local("delete", "Delete a task", [task]),
  ]),
  column: group("column", "Manage board columns", [
    local("new", "Add a column", [text("name")]),
    local("rename", "Rename a column", [column, text("new name")]),
    local("delete", "Delete a column", [column]),
  ]),
  label: group("label", "Create, color and attach labels", [
    local("new", "Create a label", [
      text("name"),
      { name: "scope", descriprion: "global|local", values: ["global", "local"] },
      { name: "color", descriprion: "[#hex]" },
    ]),
    local("add", "Attach a label to a task", [task, label]),
    local("color", "Change a label's color", [label, { name: "color", descriprion: "#hex" }]),
  ]),
  wb: group("wb", "Whiteboard", [
    group("add", "Add an item to the whiteboard", [
      local("sticky", "Sticky note", [text("text")]),
      local("text", "Free text", [text("text")]),
      local("document", "Rich-text document", [text("text")]),
      local("kanban", "Task board"),
      local("arrow", "Arrow", [text("label")]),
      local("link", "Ticket link node", [task]),
    ]),
  ]),
  tab: local("tab", "Open a view", [{ name: "view", descriprion: "<view>", values: VIEW_NAMES }]),
  split: local("split", "Show a second view beside this one", [
    { name: "view", descriprion: "<view>|off", values: [...VIEW_NAMES, "off"] },
  ]),
  theme: local("theme", "Switch the accent palette", [
    { name: "theme", descriprion: "<theme>", values: ["original", "phosphor", "amber", "violet"] },
  ]),
  checkpoint: local("checkpoint", "Save a named restore point", [text("description")]),
  revert: local("revert", "Restore a checkpoint (asks Y/N)", [
    { name: "checkpoint-id", descriprion: "<checkpoint-id>", source: "checkpoint" },
  ]),
  merge: local("merge", "Merge an incoming proposal (asks Y/N)", [
    { name: "proposal-id", descriprion: "<proposal-id>", source: "proposal" },
  ]),
  clear: local("clear", "Clear the terminal output"),
  help: local("help", "List every command"),
};
