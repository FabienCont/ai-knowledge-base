import chalk from 'chalk';
import type { Command } from 'commander';

/**
 * Output a result to stdout.
 * When `--json` flag is set, prints pretty-printed JSON.
 * Otherwise prints the human-readable message.
 */
export function output<T>(program: Command, data: T, humanMessage: string): void {
  if (program.opts<{ json?: boolean }>().json === true) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(humanMessage);
  }
}

/**
 * Print an error message to stderr and exit with the given code.
 * Never writes to stdout so that JSON output is not corrupted.
 */
export function exitError(message: string, code = 1): never {
  console.error(chalk.red(`Error: ${message}`));
  process.exit(code);
}
