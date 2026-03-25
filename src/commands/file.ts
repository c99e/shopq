import { register } from "../registry";
import { formatOutput, formatError } from "../output";
import { getClient, handleCommandError, clampLimit } from "../helpers";
import type { ParsedArgs } from "../types";

const VALID_TYPES = ["IMAGE", "VIDEO", "GENERIC_FILE"] as const;

const FILES_QUERY = `query FileList($first: Int!, $after: String, $query: String) {
  files(first: $first, after: $after, query: $query) {
    edges {
      node {
        ... on MediaImage {
          id
          alt
          mediaContentType
          fileStatus
          image { url }
          createdAt
          originalSource { fileSize }
        }
        ... on GenericFile {
          id
          alt
          mediaContentType
          fileStatus
          url
          createdAt
          originalSource { fileSize }
        }
        ... on Video {
          id
          alt
          mediaContentType
          fileStatus
          sources { url }
          createdAt
          originalSource { fileSize }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

interface FileNode {
  id: string;
  alt: string | null;
  mediaContentType: string;
  fileStatus: string;
  image?: { url: string } | null;
  url?: string;
  sources?: Array<{ url: string }>;
  createdAt: string;
  originalSource?: { fileSize: string | null };
}

interface FilesResponse {
  files: {
    edges: Array<{ node: FileNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string };
  };
}

function extractUrl(node: FileNode): string {
  if (node.image?.url) return node.image.url;
  if (node.url) return node.url;
  if (node.sources?.[0]?.url) return node.sources[0].url;
  return "";
}

function extractFilename(url: string): string {
  if (!url) return "";
  try {
    const pathname = new URL(url).pathname;
    return pathname.split("/").pop() ?? "";
  } catch {
    return url.split("/").pop() ?? "";
  }
}

async function handleFileList(parsed: ParsedArgs): Promise<void> {
  const { flags } = parsed;

  // Validate --type
  if (flags.type) {
    const typeUpper = flags.type.toUpperCase();
    if (!VALID_TYPES.includes(typeUpper as any)) {
      formatError(`Invalid --type "${flags.type}". Must be one of: ${VALID_TYPES.join(", ")}`);
      process.exitCode = 2;
      return;
    }
  }

  try {
    const client = getClient(flags);

    const limit = clampLimit(flags.limit);

    const queryParts: string[] = [];
    if (flags.type) queryParts.push(`media_type:${flags.type.toUpperCase()}`);

    const variables: Record<string, unknown> = {
      first: limit,
      query: queryParts.length > 0 ? queryParts.join(" ") : undefined,
    };

    if (flags.cursor) {
      variables.after = flags.cursor;
    }

    const result = await client.query<FilesResponse>(FILES_QUERY, variables);
    const files = result.files.edges.map((e) => {
      const url = extractUrl(e.node);
      return {
        id: e.node.id,
        filename: extractFilename(url),
        url,
        alt: e.node.alt ?? "",
        mediaType: e.node.mediaContentType,
        fileSize: e.node.originalSource?.fileSize ?? "",
        createdAt: e.node.createdAt,
      };
    });

    const pageInfo = result.files.pageInfo;

    if (flags.json) {
      formatOutput(files, [], { json: true, noColor: flags.noColor, pageInfo });
      return;
    }

    const columns = [
      { key: "id", header: "ID" },
      { key: "filename", header: "Filename" },
      { key: "url", header: "URL" },
      { key: "alt", header: "Alt" },
      { key: "mediaType", header: "Type" },
      { key: "fileSize", header: "Size" },
      { key: "createdAt", header: "Created" },
    ];

    formatOutput(files, columns, { json: false, noColor: flags.noColor, pageInfo });
  } catch (err) {
    handleCommandError(err);
  }
}

register("file", "File management", "list", {
  description: "List store files with filtering and pagination",
  handler: handleFileList,
});
