export interface ScanOptions {
  /** Glob patterns to include (default: ['**\/*']) */
  include?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
  /** Whether to read .gitignore files in each directory (default: true) */
  useGitignore?: boolean;
  /** Additional patterns to always ignore */
  defaultIgnore?: string[];
  /** Follow symlinks (default: false) */
  followSymlinks?: boolean;
  /** Maximum recursion depth (default: 20) */
  maxDepth?: number;
  /** Skip files larger than this (bytes, default: 5MB) */
  maxFileSize?: number;
  /** Root path (absolute). Required. */
  root: string;
}

export const DEFAULT_IGNORE: string[] = [
  '.git',
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '.nyc_output',
  '*.tsbuildinfo',
  '.DS_Store',
  'Thumbs.db',
];
