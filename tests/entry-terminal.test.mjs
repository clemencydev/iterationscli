import test from "node:test"
import assert from "node:assert/strict"
import { parseEntryCommand, ENTRY_COMMANDS } from "../lib/entry-terminal.ts"

test("terminal accepts existing auth commands and familiar aliases", () => {
  assert.equal(parseEntryCommand("  AUTH   LOGIN "), "login")
  assert.equal(parseEntryCommand("signin"), "login")
  assert.equal(parseEntryCommand("sign up"), "register")
  assert.equal(parseEntryCommand("cls"), "clear")
})
test("credentials passed as arguments are not accepted into canonical history", () => {
  assert.equal(parseEntryCommand("login alice secret"), null)
  assert.equal(parseEntryCommand("register --password secret"), null)
  assert.equal(parseEntryCommand(""), null)
  assert.equal(parseEntryCommand("constructor"), null)
})
test("every selectable option has a runnable command", () => {
  for (const option of ENTRY_COMMANDS)
    assert.equal(parseEntryCommand(option.command), option.command)
})
