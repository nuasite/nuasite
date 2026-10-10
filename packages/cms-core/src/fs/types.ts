/**
 * The FileSystem port: the only I/O boundary of cms-core.
 *
 * All paths are interpreted relative to the implementation's configured root.
 * Implementations must resolve them under the root and reject any path that
 * escapes it (path traversal). The same brain therefore runs unchanged over
 * `node:fs` (sidecar + local dev) and, in principle, over a remote adapter.
 */
export interface CmsFileSystem {
	/** Read a UTF-8 text file. Rejects when the file does not exist. */
	readFile(path: string): Promise<string>
	/** Read a file's raw bytes (for binary assets like images). Rejects when the file does not exist. */
	readBytes(path: string): Promise<Uint8Array>
	/** Write a UTF-8 text file atomically (write temp + rename). Creates parent dirs. */
	writeFile(path: string, content: string): Promise<void>
	/** Rename/move a file. Creates the destination's parent dir. */
	rename(from: string, to: string): Promise<void>
	/** Remove a file. No-op when it does not exist. */
	remove(path: string): Promise<void>
	/** Whether a file or directory exists. */
	exists(path: string): Promise<boolean>
	/** List the immediate children of a directory. Returns [] when it does not exist. */
	list(dir: string): Promise<{ name: string; isDirectory: boolean }[]>
	/**
	 * Resolve a glob pattern (supports `*`, `**`, `?`, `{a,b}`) to matching file paths, root-relative.
	 *
	 * Symbolic links below the pattern's static prefix are left out unless `followSymlinks` is
	 * set. With it, a linked file is listed under the link's own path, wherever it points, and
	 * a linked directory is walked as if it were there, as often as a path leads into it; a
	 * link back into a directory already entered through a link on the same path is not
	 * entered again. An implementation that ignores the option keeps leaving them out.
	 *
	 * `maxLinkedDirectories` bounds what following links adds to the walk: when listing would
	 * have to read more directories than that behind links, the call rejects instead of
	 * answering with a part of the files. Directories reached without a link do not count.
	 */
	glob(pattern: string, options?: { followSymlinks?: boolean; maxLinkedDirectories?: number }): Promise<string[]>
	/** File metadata. Rejects when the path does not exist. */
	stat(path: string): Promise<{ mtimeMs: number; size: number }>
}
