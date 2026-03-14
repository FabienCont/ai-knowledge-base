import cliProgress from 'cli-progress';
import chalk from 'chalk';

export interface ProgressBarOptions {
  total: number;
  label?: string;
}

/**
 * Create and start a single-bar progress bar.
 * Returns the bar instance so callers can call `.increment()` and `.stop()`.
 */
export function createProgressBar(opts: ProgressBarOptions): cliProgress.SingleBar {
  const bar = new cliProgress.SingleBar(
    {
      format:
        `${chalk.cyan(opts.label ?? 'Progress')} [{bar}] {percentage}% | {value}/{total}`,
      clearOnComplete: false,
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );
  bar.start(opts.total, 0);
  return bar;
}
