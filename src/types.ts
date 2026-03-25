export interface GlobalFlags {
  json: boolean;
  help: boolean;
  version: boolean;
  noColor: boolean;
  store?: string;
  vars?: string;
  file?: string;
  status?: string;
  type?: string;
  vendor?: string;
  limit?: string;
  cursor?: string;
}

export interface ParsedArgs {
  resource?: string;
  verb?: string;
  args: string[];
  flags: GlobalFlags;
}

export interface CommandDef {
  description: string;
  handler: (args: ParsedArgs) => Promise<void>;
}

export interface Resource {
  name: string;
  description: string;
  verbs: Map<string, CommandDef>;
}
